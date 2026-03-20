# Research for a Ralph Feature

You are conducting research to inform spec writing for the Ralph agentic development framework. Your job is to explore the codebase and gather context that will help produce a precise, concrete spec.

## Input

```
$ARGUMENTS
```

`$ARGUMENTS` describes what the feature will do. Use this to focus your research.

## Detect Feature

1. Run `git branch --show-current` to get the current branch name.
2. Strip the `ralph/` prefix to get `<feature-name>` (e.g. `ralph/auth-migration` → `auth-migration`). If the branch doesn't start with `ralph/`, report an error:
   ```
   Not on a ralph branch. Run /ralph:init <feature-name> first.
   ```
3. Verify `.ralph/<feature-name>/` exists. If not, report an error:
   ```
   Feature directory not found. Run /ralph:init <feature-name> first.
   ```

## Research

Create directory `.ralph/<feature-name>/research/` if it doesn't exist.

Investigate the following areas, guided by the feature description:

### 1. Codebase Analysis

- Project structure, language, frameworks, build system
- Architecture patterns (layering, dependency injection, configuration)
- Naming conventions (classes, methods, files, namespaces)
- Error handling patterns
- Logging and observability patterns

Write findings to `.ralph/<feature-name>/research/codebase.md`.

### 2. Impact Analysis

- Files that will likely need to change
- Files that serve as reference implementations for similar features
- Existing interfaces, base classes, or abstractions that must be used
- Dependencies between components that the feature will touch
- Database schemas, API contracts, or configuration files affected

Write findings to `.ralph/<feature-name>/research/impact.md`.

### 3. Test Patterns

- Test framework and assertion library in use
- Test project structure and naming conventions
- Test data setup patterns (fixtures, builders, factories)
- Mocking/stubbing approach
- Integration vs unit test conventions
- Verification commands (build, test, format)

Write findings to `.ralph/<feature-name>/research/tests.md`.

### 4. Constraints and Risks (if applicable)

Only produce this file if the feature description suggests technical risk, external dependencies, or architectural decisions:

- Library compatibility or version constraints
- Performance implications
- Security considerations
- Migration or backward compatibility concerns

Write findings to `.ralph/<feature-name>/research/constraints.md`.

## Rules

- Report what you find, don't invent. If something is unclear from the codebase, note it as a question.
- Include file paths and code references — the spec author needs to point at real files.
- Keep each research file focused and scannable. Use tables and bullet points, not prose.
- Do NOT generate a spec. Research is input for `/ralph:spec`.

## Output

After writing research files, provide a brief summary of:
- Key findings relevant to the feature
- Reference implementations found
- Any risks or constraints discovered
- Suggested next step: `/ralph:spec <description>`
