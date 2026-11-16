# Managed by go-conventions (references/ci.md owns the target contract);
# converge rewrites it. `check` is the local gate; CI runs it and adds
# govulncheck (references/ci.md, "The gates").
GOLANGCI_LINT_VERSION ?= v2.14.0
# Module directories, relative to this file; a single-module repo uses ".".
MODULES ?= .
GOBIN ?= $(shell go env GOPATH)/bin

.DEFAULT_GOAL := help

.PHONY: help
help: ## Print this help message
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make <target>\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: print-golangci-version
print-golangci-version: ## Print the pinned golangci-lint version (CI reads this)
	@echo $(GOLANGCI_LINT_VERSION)

.PHONY: tools
tools: ## Install the pinned golangci-lint into GOBIN
	curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh \
	  | sh -s -- -b "$(GOBIN)" $(GOLANGCI_LINT_VERSION)

.PHONY: build
build: ## Compile every package
	@for m in $(MODULES); do (cd "$$m" && go build ./...) || exit 1; done

.PHONY: generate
generate: ## Run go generate (counterfeiter fakes and the like)
	@for m in $(MODULES); do (cd "$$m" && go generate ./...) || exit 1; done

.PHONY: generate-check
generate-check: generate ## Fail when go generate changes a tracked file
	@git diff --quiet -- $(MODULES) || { git --no-pager diff --stat -- $(MODULES); echo "go generate output is stale"; exit 1; }

.PHONY: fmt
fmt: ## Apply gofmt, gofumpt, and goimports through golangci-lint
	@for m in $(MODULES); do (cd "$$m" && golangci-lint fmt ./...) || exit 1; done

.PHONY: fmt-check
fmt-check: ## Fail when formatting would change a file
	@for m in $(MODULES); do \
	  out=$$(cd "$$m" && golangci-lint fmt --diff ./...) || exit 1; \
	  if [ -n "$$out" ]; then printf '%s\n' "$$out"; echo "formatting needed in $$m"; exit 1; fi; \
	done

.PHONY: vet
vet: ## go vet
	@for m in $(MODULES); do (cd "$$m" && go vet ./...) || exit 1; done

.PHONY: lint
lint: ## golangci-lint run
	@for m in $(MODULES); do (cd "$$m" && golangci-lint run ./...) || exit 1; done

.PHONY: fix
fix: ## Apply the go fix modernizers
	@for m in $(MODULES); do (cd "$$m" && go fix ./...) || exit 1; done

.PHONY: fix-check
fix-check: ## Fail when go fix would change a file
	@for m in $(MODULES); do \
	  out=$$(cd "$$m" && go fix -diff ./...) || exit 1; \
	  if [ -n "$$out" ]; then printf '%s\n' "$$out"; echo "go fix needed in $$m"; exit 1; fi; \
	done

.PHONY: tidy
tidy: ## go mod tidy
	@for m in $(MODULES); do (cd "$$m" && go mod tidy) || exit 1; done

.PHONY: tidy-check
tidy-check: ## Fail when go mod tidy would change go.mod or go.sum
	@for m in $(MODULES); do (cd "$$m" && go mod tidy -diff) || { echo "go mod tidy needed in $$m"; exit 1; }; done

.PHONY: test
test: ## Run every suite with the race detector
	@for m in $(MODULES); do (cd "$$m" && go test -race -count=1 ./...) || exit 1; done

.PHONY: check
check: generate-check fmt-check vet lint fix-check tidy-check test ## The local gate

# The committed data under data/. Outside the go-conventions contract above.

# fetch reads the token from ROOKSTATS_GITHUB_TOKEN, GH_TOKEN or
# GITHUB_TOKEN; with none of them set, gh's token is passed to fetch alone.
.PHONY: data-refresh
data-refresh: ## Pull from GitHub, re-derive the records, read new ticket types, check
	@if [ -z "$${ROOKSTATS_GITHUB_TOKEN}$${GH_TOKEN}$${GITHUB_TOKEN}" ]; then \
	  ROOKSTATS_GITHUB_TOKEN=$$(gh auth token) || exit 1; \
	  export ROOKSTATS_GITHUB_TOKEN; \
	fi; \
	go run ./cmd/rookstats fetch
	go run ./cmd/rookstats extract
	go run ./cmd/rookstats tickets
	go run ./cmd/rookstats check

.PHONY: data-check
data-check: ## Validate the hand-edited tables in data/ against the records
	go run ./cmd/rookstats check

# The reports rank accounts by comment count: for whoever edits the tables,
# never for CI's public log.
.PHONY: data-report
data-report: ## Validate the tables and report what they do not yet match
	go run ./cmd/rookstats check --report

# The statistics site under site/ (Vite, Svelte, TypeScript). Outside the
# go-conventions contract above. The site fetches its data at run time from
# site/public/data/, which `rookstats rollup` writes and git ignores.
SITE_DIR := site
SITE_DATA := $(SITE_DIR)/public/data
SITE_FIXTURE := $(SITE_DIR)/src/lib/__fixtures__/data
# npm ci writes this file, so it stands for node_modules installed from the
# current lockfile.
SITE_DEPS := $(SITE_DIR)/node_modules/.package-lock.json

$(SITE_DEPS): $(SITE_DIR)/package-lock.json
	cd $(SITE_DIR) && npm ci --ignore-scripts

.PHONY: site-install
site-install: ## Install the site's npm dependencies from the lockfile
	cd $(SITE_DIR) && npm ci --ignore-scripts

.PHONY: site-data
site-data: ## Roll the records up into the site's data files
	go run ./cmd/rookstats rollup --out $(SITE_DATA)

.PHONY: site-dev-data
site-dev-data: ## Use the test fixture as the site's data (no Go side needed)
	rm -rf $(SITE_DATA)
	mkdir -p $(SITE_DATA)
	cp $(SITE_FIXTURE)/*.json $(SITE_DATA)/

.PHONY: site-build
site-build: $(SITE_DEPS) site-data ## Build the site into site/dist from freshly rolled-up data
	cd $(SITE_DIR) && npm run build

.PHONY: site-test
site-test: $(SITE_DEPS) ## Typecheck and unit-test the site
	cd $(SITE_DIR) && npm run typecheck && npm test

# Playwright's Chromium is installed once per machine (CI installs it in the
# workflow); without it, run `npx playwright install chromium` in site/.
.PHONY: site-e2e
site-e2e: site-build ## Build the site from the data and run the browser smoke test
	cd $(SITE_DIR) && npm run e2e
