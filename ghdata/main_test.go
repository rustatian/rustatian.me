package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The expected values come from UserContract and ContributionsContract in src/api/contracts.ts
// and from the zod schemas of src/worker/user.ts and src/worker/contributions.ts.

const calendar = `{"data":{"user":{"contributionsCollection":{"contributionCalendar":{"totalContributions":17,"weeks":[{"contributionDays":[{"date":"2026-04-12","contributionCount":0,"contributionLevel":"NONE"},{"date":"2026-04-13","contributionCount":1,"contributionLevel":"FIRST_QUARTILE"}]},{"contributionDays":[{"date":"2026-04-19","contributionCount":2,"contributionLevel":"SECOND_QUARTILE"},{"date":"2026-04-20","contributionCount":5,"contributionLevel":"THIRD_QUARTILE"},{"date":"2026-04-21","contributionCount":9,"contributionLevel":"FOURTH_QUARTILE"}]}]}}}}}`

func TestProjectUser(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		want    string
		wantErr string
	}{
		{name: "public schema keeps the contract fields", body: `{"login":"rustatian","id":8040338,"public_repos":71,"followers":207,"following":1,"user_view_type":"public"}`, want: `{"login":"rustatian","public_repos":71,"followers":207,"following":1}`},
		{name: "private schema drops the owner-only fields", body: `{"login":"rustatian","public_repos":42,"followers":100,"following":7,"total_private_repos":34,"owned_private_repos":34,"disk_usage":588668,"collaborators":3,"two_factor_authentication":true,"email":"private@example.com","plan":{"name":"free"}}`, want: `{"login":"rustatian","public_repos":42,"followers":100,"following":7}`},
		{name: "zero counts are valid", body: `{"login":"rustatian","public_repos":0,"followers":0,"following":0}`, want: `{"login":"rustatian","public_repos":0,"followers":0,"following":0}`},
		{name: "missing field fails", body: `{"login":"rustatian","public_repos":71,"following":1}`, wantErr: "missing"},
		{name: "null field fails", body: `{"login":"rustatian","public_repos":null,"followers":1,"following":1}`, wantErr: "missing"},
		{name: "string count fails", body: `{"login":"rustatian","public_repos":"71","followers":1,"following":1}`, wantErr: "decode user"},
		{name: "malformed JSON fails", body: `{"login":`, wantErr: "decode user"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := projectUser([]byte(tc.body))
			check(t, got, err, tc.want, tc.wantErr)
		})
	}
}

func TestProjectContributions(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		want    string
		wantErr string
	}{
		{name: "maps each level and keeps the order", body: calendar, want: `{"totalContributions":17,"days":[{"date":"2026-04-12","count":0,"level":0},{"date":"2026-04-13","count":1,"level":1},{"date":"2026-04-19","count":2,"level":2},{"date":"2026-04-20","count":5,"level":3},{"date":"2026-04-21","count":9,"level":4}]}`},
		{name: "empty calendar gives an empty day list", body: `{"data":{"user":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[]}}}}}`, want: `{"totalContributions":0,"days":[]}`},
		{name: "errors with HTTP 200 fail", body: `{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}`, wantErr: "RATE_LIMITED: API rate limit exceeded"},
		{name: "errors next to data fail", body: strings.Replace(calendar, `{"data":`, `{"errors":[{"type":"FORBIDDEN","message":"partial failure"}],"data":`, 1), wantErr: "FORBIDDEN: partial failure"},
		{name: "error without a type fails", body: `{"errors":[{"message":"Parse error"}]}`, wantErr: "graphql: Parse error"},
		{name: "null user fails", body: `{"data":{"user":null}}`, wantErr: "user is null"},
		{name: "missing data fails", body: `{}`, wantErr: "user is null"},
		{name: "unknown level fails", body: strings.Replace(calendar, `"contributionCount":9,"contributionLevel":"FOURTH_QUARTILE"`, `"contributionCount":9,"contributionLevel":"FIFTH_QUARTILE"`, 1), wantErr: "FIFTH_QUARTILE"},
		{name: "lowercase level fails", body: strings.Replace(calendar, `"contributionCount":0,"contributionLevel":"NONE"`, `"contributionCount":0,"contributionLevel":"none"`, 1), wantErr: "none"},
		{name: "negative count fails", body: strings.Replace(calendar, `"contributionCount":1,`, `"contributionCount":-1,`, 1), wantErr: "negative"},
		{name: "negative total fails", body: strings.Replace(calendar, `"totalContributions":17`, `"totalContributions":-1`, 1), wantErr: "negative"},
		{name: "malformed JSON fails", body: `{"data":`, wantErr: "decode calendar"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := projectContributions([]byte(tc.body))
			check(t, got, err, tc.want, tc.wantErr)
		})
	}
}

func TestRun(t *testing.T) {
	const userBody = `{"login":"rustatian","public_repos":71,"followers":207,"following":1,"site_admin":false}`
	const calendarBody = `{"data":{"user":{"contributionsCollection":{"contributionCalendar":{"totalContributions":3,"weeks":[{"contributionDays":[{"date":"2026-11-08","contributionCount":3,"contributionLevel":"SECOND_QUARTILE"},{"date":"2026-11-09","contributionCount":0,"contributionLevel":"NONE"}]}]}}}}}`
	type answer struct {
		status int
		body   string
	}
	cases := []struct {
		name         string
		token        string
		user         answer
		graphql      answer
		wantErr      string
		wantUser     string
		wantCalendar string
		wantRequests int
	}{
		{name: "writes both files", token: "test-token", user: answer{200, userBody}, graphql: answer{200, calendarBody}, wantUser: `{"login":"rustatian","public_repos":71,"followers":207,"following":1}`, wantCalendar: `{"totalContributions":3,"days":[{"date":"2026-11-08","count":3,"level":2},{"date":"2026-11-09","count":0,"level":0}]}`, wantRequests: 2},
		{name: "user HTTP error stops the run", token: "test-token", user: answer{503, ""}, wantErr: "GET /users/rustatian: HTTP 503", wantRequests: 1},
		{name: "GraphQL HTTP error writes no file", token: "test-token", user: answer{200, userBody}, graphql: answer{401, `{"message":"Bad credentials"}`}, wantErr: "POST /graphql: HTTP 401: Bad credentials", wantRequests: 2},
		{name: "GraphQL errors write no file", token: "test-token", user: answer{200, userBody}, graphql: answer{200, `{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}`}, wantErr: "RATE_LIMITED: API rate limit exceeded", wantRequests: 2},
		{name: "empty token is refused", token: "", wantErr: "GITHUB_TOKEN", wantRequests: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
					t.Errorf("Authorization = %q", got)
				}
				var a answer
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/users/rustatian":
					a = tc.user
				case r.Method == http.MethodPost && r.URL.Path == "/graphql":
					if got := r.Header.Get("Content-Type"); got != "application/json" {
						t.Errorf("Content-Type = %q", got)
					}
					var q struct {
						Query     string          `json:"query"`
						Variables json.RawMessage `json:"variables"`
					}
					b, _ := io.ReadAll(r.Body)
					if err := json.Unmarshal(b, &q); err != nil {
						t.Errorf("decode request: %v", err)
					}
					if string(q.Variables) != `{"login":"rustatian"}` {
						t.Errorf("variables = %s", q.Variables)
					}
					if !strings.Contains(q.Query, "contributionCalendar") {
						t.Errorf("query = %q", q.Query)
					}
					a = tc.graphql
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					return
				}
				w.WriteHeader(a.status)
				_, _ = io.WriteString(w, a.body)
			}))
			defer srv.Close()

			dir := t.TempDir()
			err := run(srv.Client(), srv.URL, tc.token, dir)
			if requests != tc.wantRequests {
				t.Errorf("requests = %d, want %d", requests, tc.wantRequests)
			}
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want it to contain %q", err, tc.wantErr)
				}
				if _, statErr := os.Stat(filepath.Join(dir, "api")); !os.IsNotExist(statErr) {
					t.Errorf("%s/api exists after a failed run", dir)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			for file, want := range map[string]string{"user": tc.wantUser, "contributions": tc.wantCalendar} {
				got, err := os.ReadFile(filepath.Join(dir, "api", "v1", "github", file))
				if err != nil {
					t.Fatal(err)
				}
				if string(got) != want {
					t.Errorf("%s = %s, want %s", file, got, want)
				}
			}
		})
	}
}

func check(t *testing.T, got []byte, err error, want, wantErr string) {
	t.Helper()
	if wantErr != "" {
		if err == nil || !strings.Contains(err.Error(), wantErr) {
			t.Fatalf("err = %v, want it to contain %q", err, wantErr)
		}
		return
	}
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if string(got) != want {
		t.Errorf("got %s, want %s", got, want)
	}
}
