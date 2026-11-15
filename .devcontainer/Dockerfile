FROM node:26-slim

USER root

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        python3 \
        build-essential \
        unzip \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v1.4.4 && \
    mv /root/.bun/bin/bun /usr/local/bin/bun

USER node

WORKDIR /workspace

COPY package.json ./
COPY bun.lock ./

RUN bun install

COPY . .

ENV PATH="/workspace/node_modules/.bin:${PATH}"

EXPOSE 5173

SHELL ["/bin/bash", "-c"]

CMD ["bun", "run", "dev", "--host"]