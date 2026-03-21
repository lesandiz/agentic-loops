# Generate or Refine a Ralph SPEC.md

You are helping write a spec for the Ralph agentic development framework. The spec drives autonomous agent execution — precision is critical because the agent cannot ask clarifying questions at runtime.

## Input

```
$ARGUMENTS
```

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

## Determine Action

- If `.ralph/<feature-name>/SPEC.md` does NOT exist → **Generate** a new spec
- If `.ralph/<feature-name>/SPEC.md` exists → **Refine** the existing spec

### Generate (first run)

1. Read `.ralph/_template/SPEC.md` to understand the structural template.
2. If `.ralph/<feature-name>/research/` exists, read research artifacts for context.
3. **Explore the codebase** thoroughly:
   - Project structure, language, frameworks, build system
   - Existing patterns, naming conventions, architecture
   - Files that will need to change or serve as reference implementations
   - Test patterns (framework, assertion style, project structure)
4. Interpret `$ARGUMENTS` as the feature description.
5. Generate `SPEC.md` following the template structure exactly. Fill every section with concrete, project-specific content based on the description, research artifacts, and codebase exploration.
6. Write the spec to `.ralph/<feature-name>/SPEC.md`.

### Refine (subsequent runs)

1. Read the existing `.ralph/<feature-name>/SPEC.md`.
2. Interpret `$ARGUMENTS` as refinement instructions (e.g. "add error handling for expired tokens", "split phase 2 into two phases", "fix DD-3 to use middleware").
3. If the refinement requires understanding new parts of the codebase, explore them.
4. Apply the requested changes to the spec while preserving the overall structure and unaffected sections.
5. Write the updated spec to `.ralph/<feature-name>/SPEC.md`.

## Ambiguity Resolution

When information is ambiguous, missing, or requires a human decision, do NOT guess. Ask the user directly before proceeding. Do not write ambiguous or placeholder content into the spec.

## Quality Rules

These apply to BOTH generation and refinement:

- **Exhaustive Changes table** — if a file isn't listed, the agent won't touch it
- **No vague criteria** — every acceptance criterion must be mechanically verifiable ("works correctly" is not acceptable)
- **No implementation choices left to the agent** — decide patterns, names, and approaches in the spec
- **Code snippets for anything non-trivial** — the agent will hallucinate patterns without them
- **Phase ordering** — group sequential/dependent work together; independent components get separate phases
- **Phase markers** — wrap each phase in `<!-- phase:N:start -->` and `<!-- phase:N:end -->` HTML comments. This allows agents to read only the active phase instead of the full spec. See the SPEC.md template for the exact format.
- **Test Cases must map to Changes** — every row in the Changes table should have corresponding test coverage via the `Covers` column
- **Ask, don't assume** — if something is unclear, ask the user rather than making plausible but potentially incorrect decisions

## Output

After writing the spec, provide a brief summary of:
- What was generated/changed
- How many phases and changes are defined
- Any areas that may need human attention or further refinement
