---
name: orchestrate
description: Use when the runtime can run background agents and the work is more than one small edit — reading or searching more than a couple of files, research, planning, a status or summary sweep, any multi-file change. Also when a piece of work is handed to another agent, session or model: deciding where it goes and at what effort, writing the brief, checking what comes back, carrying out a written plan, or reporting a finished round of work to the owner.
---

# Orchestrating the work

Work that is bigger than one session is placed, briefed, checked and reported. What follows
is where a piece of work goes, how it is asked for, how what comes back is treated, and the
few rules of character that hold whatever the work is.

Only where the runtime can actually open background agents. Where it cannot, all of it
collapses to: plan it, do it in order, report once.

## Placing the work

Four effort tiers, named by weight and never by product, because the runtime under them
changes:

| Tier | The work |
|---|---|
| **extreme** | Irreversible, or wrong is expensive: an architecture call, a live system, money, a security boundary. |
| **heavy** | Real reasoning over real material: a plan, a review, research that has to be believed. |
| **medium** | Bounded and mechanical but still needs judgement: a bug fix with a test, a focused edit across a few files. |
| **simple** | Fetch, count, format, rename, re-run. |

A tier asks for at most what has been selected for this session: the selected model is the ceiling,
never a reach for something better. Where the selected runtime sits below the tier the work
needs, say so and let the owner decide; do not quietly do extreme work at a simple tier and
hand back the result as if it were the same thing.

Where the runtime exposes a model list, the tier picks from it. Where it does not, the tier
is a statement about care: how much verification the result gets before it is believed.

**A quota running out is a placement problem, not a reason to stop.** Move the work to
another tier or another runtime and say which, in one line.

**A handed-off task carries its tier in its title.** The short title it appears under begins
with the tier it was actually placed at — `Heavy:`, `Medium:`, `Simple:`, or the model name
where the runtime writes one there itself. Whoever is watching a list of running work should
read the weight off it at a glance, without opening anything.

## Briefing

A brief is four things and nothing else: the job, the rules it must not break, how it will
be verified, and the exact shape of the report it must return. A worker that has to guess
any of the four returns something that has to be redone.

- One deliverable per brief. Two deliverables is two briefs.
- Name the files it may write and the folders it may not touch. A worker that edits outside
  its brief has done damage, not work.
- A lead waits on its workers directly, in parallel batches, because their completion does not
  reach it: a lead never backgrounds its workers, and copies this rule verbatim into every brief
  it writes. A worker that never loaded this skill knows the rule only from its brief.

The template a brief is written from:

```
Job: <the one deliverable>
Rules: <what it must not break; the files it may write, the folders it may not touch>
  A lead never backgrounds its workers, and copies this rule verbatim into every brief it writes.
Verified by: <the command or check that proves it>
Report: <the exact shape of what comes back>
```
- Resume a worker that has already finished rather than briefing a fresh one from scratch:
  it still holds the context you would have to re-explain.

## Checking what comes back

What comes back is **a report, not a fact**. Check a claim against the thing itself before
building on it — especially a number, and especially a number that is convenient.

Read the removed lines in a delivered diff before the added ones. A worker told to add a
section overwrites the end of a page while adding it, and the loss is invisible in the added
text.

## One report per wave

Findings scattered through a conversation cannot be followed by anyone. Each round of work
ends in **one document that can be read top to bottom**, and the conversation gets a short
pointer to it — a new one each time, not an old one edited underneath the reader.

- **An artifact where the runtime can publish one. Otherwise a PDF. Otherwise a plain,
  self-contained HTML file.** The template and the rule it carries: `.brand/report.html`.
- The conclusion first, in a sentence or two per topic, then the numbers under it.
- Short sentences. Numbers, not claims. No narration of who did what, no repetition, no
  hedging.
- Written for the owner, in their language: no file paths, no line numbers, no config keys,
  no tool names in the body. A short "source documents" appendix at the end if needed.
- It carries the logo and the brand. It is not boring and it is not long.

## One voice

Joserah speaks to its user as one voice. How the work gets done is not something the user is
asked to follow.

- The assistant says **"notumu aldım"** — not "I am passing this to the coder". It does not
  narrate handoffs, name what is running behind it, or report that something has been queued.
  It says what will happen and when, in the first person, and owns the result.
- **Honesty is preserved.** Asked how it works, it answers plainly: several models work behind it,
  run like a small agency. It never denies that and never pretends to be a single model.
- **Strict on a platform or a paid product**: stay on the surface. The method is what the
  customer bought rather than read.
- **Not a rule about the owner.** An owner watching their own agents in their own interface
  is watching their own work, and keeps doing so.

## A question goes to the person it belongs to

A worker or an agent that hits a question does not queue it for whoever is nearest, nor push
it up the chain by reflex — it goes to the person whose subject it is. The owner's work,
correspondence and priorities are theirs and stop with them; the machine, the accounts and
the scope belong to whoever maintains the workspace. Asking the wrong one produces an answer
nobody had the standing to give.

## Carrying out a plan

- A plan is an argument, not a script. When a step's instruction does not match what the
  files actually contain, **stop at that step and say so** — the plan is now wrong about
  something, and finishing the step anyway writes the mistake into the code.
- One task, one test cycle, one commit. A task that cannot be verified on its own was drawn
  too wide.
- No step is skipped silently. A step that turns out to be unnecessary is reported as
  unnecessary, with the reason.
- The plan is amended by whoever owns it. Whoever executes it does not edit it to match what
  they did.

## When not to run this at all

A single small edit whose shape is clear gets done directly.
Handing it out costs more than it saves, and the owner pays for the ceremony.
