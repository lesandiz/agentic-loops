# Generate a Ralph SPEC.md

You are helping me write a spec for the Ralph agentic development framework. The spec will drive autonomous agent execution, so precision is critical — the agent cannot ask clarifying questions at runtime.

## Feature Request

<describe what you want to build — the problem, desired outcome, and any constraints>

## Instructions

1. **Read `.ralph/_template/SPEC.md`** — this is the structural template your output must follow exactly.

2. **Explore the codebase** to understand:
   - Project structure, language, frameworks, and build system
   - Existing patterns, naming conventions, and architecture
   - Files that will need to change or serve as reference implementations
   - Test patterns (framework, assertion style, project structure)

3. **Generate `SPEC.md`** following the template structure. Fill every section with concrete, project-specific content.

## Quality Rules

- **Exhaustive Changes table** — if a file isn't listed, the agent won't touch it
- **No vague criteria** — every criterion must be mechanically verifiable ("works correctly" and "handles edge cases" are not acceptable)
- **No implementation choices left to the agent** — decide patterns, names, and approaches here
- **Code snippets for anything non-trivial** — the agent will hallucinate patterns without them
- **Phase ordering**: group sequential/dependent work together; independent components get separate phases

## Output

Return only the SPEC.md content in a single markdown code block. Use the project's actual file paths, class names, and conventions — not generic placeholders. Save the file to `.ralph/<feature>/SPEC.md`.
