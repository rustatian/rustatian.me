// Command ghdata writes the GitHub data of the homepage into the build output.
// The output paths are the routes of src/api/routes.ts.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const login = "rustatian"

// A copy of CONTRIBUTIONS_QUERY in src/worker/contributions.ts.
const contributionsQuery = `query ContribCal($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`

// The values of the GitHub enum ContributionLevel, numbered as the contribution grid expects.
// https://docs.github.com/en/graphql/reference/users#enum-contributionlevel
var levels = map[string]int{"NONE": 0, "FIRST_QUARTILE": 1, "SECOND_QUARTILE": 2, "THIRD_QUARTILE": 3, "FOURTH_QUARTILE": 4}

// The fields of UserContract in src/api/contracts.ts. Pointers, so that a missing or null field fails.
type user struct {
	Login       *string `json:"login"`
	PublicRepos *int    `json:"public_repos"`
	Followers   *int    `json:"followers"`
	Following   *int    `json:"following"`
}

type day struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
	Level int    `json:"level"`
}

type contributions struct {
	TotalContributions int   `json:"totalContributions"`
	Days               []day `json:"days"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: GITHUB_TOKEN=<token> go run . <build dir>")
		os.Exit(1)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	if err := run(client, "https://api.github.com", os.Getenv("GITHUB_TOKEN"), os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "ghdata:", err)
		os.Exit(1)
	}
}

// run checks both answers before it writes a file, so a failed run leaves the build without the data.
func run(client *http.Client, api, token, dir string) error {
	if token == "" {
		return errors.New("GITHUB_TOKEN is empty")
	}
	body, err := call(client, http.MethodGet, api+"/users/"+login, token, nil)
	if err != nil {
		return err
	}
	userJSON, err := projectUser(body)
	if err != nil {
		return err
	}
	query, err := json.Marshal(map[string]any{"query": contributionsQuery, "variables": map[string]string{"login": login}})
	if err != nil {
		return err
	}
	body, err = call(client, http.MethodPost, api+"/graphql", token, query)
	if err != nil {
		return err
	}
	calendarJSON, err := projectContributions(body)
	if err != nil {
		return err
	}
	out := filepath.Join(dir, "api", "v1", "github")
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(out, "user"), userJSON, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "contributions"), calendarJSON, 0o644)
}

func call(client *http.Client, method, url, token string, body []byte) ([]byte, error) {
	var payload io.Reader
	if body != nil {
		payload = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, payload)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "rustatian.me-ghdata")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg := fmt.Sprintf("%s %s: HTTP %d", method, req.URL.Path, resp.StatusCode)
		// GitHub puts the reason into a message field, for example "Bad credentials".
		var e struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(b, &e) == nil && e.Message != "" {
			msg += ": " + e.Message
		}
		return nil, errors.New(msg)
	}
	return b, nil
}

// projectUser keeps only the contract fields: with the token of the account owner,
// GitHub answers with the private-user schema.
func projectUser(body []byte) ([]byte, error) {
	var u user
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}
	if u.Login == nil || u.PublicRepos == nil || u.Followers == nil || u.Following == nil {
		return nil, errors.New("user: a contract field is missing or null")
	}
	return json.Marshal(u)
}

// projectContributions flattens the weeks into days in the order of the answer, oldest first,
// as gridCellsFromDays and computeStreak expect. GitHub sends GraphQL errors with HTTP 200.
func projectContributions(body []byte) ([]byte, error) {
	var r struct {
		Data struct {
			User *struct {
				ContributionsCollection struct {
					ContributionCalendar struct {
						TotalContributions int `json:"totalContributions"`
						Weeks              []struct {
							ContributionDays []struct {
								Date              string `json:"date"`
								ContributionCount int    `json:"contributionCount"`
								ContributionLevel string `json:"contributionLevel"`
							} `json:"contributionDays"`
						} `json:"weeks"`
					} `json:"contributionCalendar"`
				} `json:"contributionsCollection"`
			} `json:"user"`
		} `json:"data"`
		Errors []struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("decode calendar: %w", err)
	}
	if len(r.Errors) > 0 {
		msgs := make([]string, len(r.Errors))
		for i, e := range r.Errors {
			msgs[i] = e.Message
			if e.Type != "" {
				msgs[i] = e.Type + ": " + e.Message
			}
		}
		return nil, fmt.Errorf("graphql: %s", strings.Join(msgs, "; "))
	}
	if r.Data.User == nil {
		return nil, errors.New("graphql: user is null")
	}
	cal := r.Data.User.ContributionsCollection.ContributionCalendar
	if cal.TotalContributions < 0 {
		return nil, errors.New("negative totalContributions")
	}
	// An empty slice, because json.Marshal writes a nil slice as null and the client expects an array.
	out := contributions{TotalContributions: cal.TotalContributions, Days: []day{}}
	for _, w := range cal.Weeks {
		for _, d := range w.ContributionDays {
			level, ok := levels[d.ContributionLevel]
			if !ok {
				return nil, fmt.Errorf("unknown contributionLevel %q on %s", d.ContributionLevel, d.Date)
			}
			if d.ContributionCount < 0 {
				return nil, fmt.Errorf("negative contributionCount on %s", d.Date)
			}
			out.Days = append(out.Days, day{Date: d.Date, Count: d.ContributionCount, Level: level})
		}
	}
	return json.Marshal(out)
}
