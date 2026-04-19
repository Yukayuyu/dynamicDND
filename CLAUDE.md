# DynamicDND

Online multiplayer D&D simulation with an AI Dungeon Master.

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never use `mcp__claude-in-chrome__*` tools.**

Available gstack skills:

- `/office-hours` — structured async Q&A / office hours session
- `/plan-ceo-review` — plan a CEO review
- `/plan-eng-review` — plan an engineering review
- `/plan-design-review` — plan a design review
- `/design-consultation` — design consultation session
- `/design-shotgun` — rapid design exploration
- `/design-html` — generate HTML designs
- `/review` — code review
- `/ship` — ship a feature end-to-end
- `/land-and-deploy` — land a PR and deploy
- `/canary` — canary deployment
- `/benchmark` — run benchmarks
- `/browse` — headless browser for web browsing, QA, and site testing
- `/connect-chrome` — connect to a Chrome instance
- `/qa` — full QA pass
- `/qa-only` — QA without shipping
- `/design-review` — design review session
- `/setup-browser-cookies` — set up browser cookies
- `/setup-deploy` — configure deployment
- `/retro` — run a retrospective
- `/investigate` — investigate a bug or issue
- `/document-release` — document a release
- `/codex` — codex-style deep research
- `/cso` — chief of staff operations
- `/autoplan` — auto-generate a plan
- `/plan-devex-review` — plan a developer experience review
- `/devex-review` — developer experience review
- `/careful` — careful/cautious mode for risky changes
- `/freeze` — freeze a branch
- `/guard` — guard a branch from changes
- `/unfreeze` — unfreeze a branch
- `/gstack-upgrade` — upgrade gstack
- `/learn` — learning and onboarding session

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, save state, save my work → invoke context-save
- Resume, where was I, pick up where I left off → invoke context-restore
- Code quality, health check → invoke health
