# Case — 2026-10-07 Finance Control session (ATAY-PC)

> **Held aside for review, NOT generalized.** Serkan's own feedback from one long working session.
> Recorded as it happened, so that native prompts and methods can be reworked from it later.
> Do not turn any line here into a rule without going back to the case.

Context: Serkan, under real money stress ("Her yerden fatura ve borç yağıyor", "borçlar konusunda
sıçmış durumdayız"), moved Finance Control from the laptop to ATAY-PC and fed in all his bank
documents. The main session talked; Lead and its workers did the writes; the laptop session did
the uploads over a cross-session channel.

## Where he got angry — in order, with his words

| # | What the assistant did | Serkan | What it shows |
|---|---|---|---|
| 1 | Asked him to carry "the three values" from the laptop vault (DB password, SECRET_KEY, first-login code) | "Ne değeri ya" | It asked for internals he had no reason to know. The right move was to propose new values at once, which is what was finally done. |
| 2 | Told him to type `/add-dir D:\atay` | "/add-dir isn't available in this environment." → "Offf" | It gave a command without knowing whether this surface supports it. |
| 3 | Laid out verbatim bank figures as a "proposal awaiting approval" | "Ekle tabi aq bunlar kesin veri." | The skill says "always propose before writing". For figures read off a document, that rule only cost him time. |
| 4 | Put the stale ₺115.000 salary to him as a question | "Nasıl ya 115 değil maaşımı biliyo olmalısın. 135 + 25 (Elden ama borç için kesiliyor.)" | A stale record was treated as the truth, and the newest document as the doubt. |
| 5 | Asked whether the DualSense and robot vacuum were refunds, and offered to record their instalments | "ürün bazında işleme yapma saçmalama. bunları aldığımı bilmiyo musun aq." / "Senle tartışmadan iş mi yapıyoruz?" | Both purchases were already on record and it did not search first. It also went down to item level when he works at statement level. |
| 6 | Rent was still "planned" in the app while the batch was queued | "Kira ödendi biliyosun." | It knew, but the app showed otherwise. He judges by what the app shows, not by what is queued. |
| 7 | Sent long interim reports while the batch ran | "ABi çok yazı yazmışsın okumadım belgeler bitmeden konuşma" | During a batch he wants silence, then one report. |
| 8 | Asked whether payments were made, and asked for more documents | "Ödendi mi diye niye soruyosun? belgeleri vermedim mi?" / "Abi ödememişim işte ne zorluyosun?" / "AMK ELİNDE BELGELER VAR BAŞKA GÖRMEDİĞİN İŞLEM YOK." | The documents were the whole record: a payment absent from them was not made. It kept asking anyway. |
| 9 | Asked whether to add Binance as an asset | "Varlıklar da binance niye yok?" | An obvious addition was put to him as a question. |
| 10 | Listed the app's three stale open notes in the summary | "kapat şu eski açık notlar listesini eski şeylerle dolu" | Stale state was surfaced instead of cleaned up. |
| 11 | Gave no progress signal on the batch | "Ne zaman bitecek işleme?" | He had no idea how long it would take or where it stood. |

The pattern across 3, 4, 5, 8 and 9: **the assistant asked where it should have concluded.** Each
question handed back work he had already done, either by giving the documents or by having it on
record.

## What worked

- The laptop and ATAY-PC sessions talked over Remote Control and the move happened with no data
  loss. Before deleting, the laptop checked that nothing had been written after the dump, and it
  refused to delete on a relayed yes until it heard Serkan himself.
- Reading the documents ourselves instead of using the app's paid AI extraction, with every figure
  quoted verbatim. No figure was challenged.
- Generating new secrets instead of carrying the old ones. Once explained, it took one sentence.
- The Binance read-only check found the IP lock, gave him the exact IP to whitelist, and worked on
  the first try afterwards.

## Process friction, seen from inside

- **Lead layering.** Every job produced extra notices ("started: builder …", "relay", "closed") and
  extra turns for the main session. Each of those turns is a reply Serkan reads or skips.
- **Hooks against the owner's wish.** The stop hook demanded "save the deliverable as Markdown" on
  conversational turns, while Serkan wanted fewer words.
- **The `keys/` rule vs. the skill.** The finance-update skill read the token straight from
  `keys/`. Workers were blocked from it, while the main session `cat`-ed it. The fix was to move it
  into the vault (`finance.control.update-token`).
- **Encoding.** Turkish text sent through Git Bash `curl` arguments on Windows arrived garbled
  (`ş` dropped, `Ö` turned into U+FFFD). Use psql stdin or a JSON file.
- **Environment assumptions.** `.mcp.json` is shared between machines but holds laptop paths, so
  Google MCP failed on ATAY-PC until the key was copied. Docker was off at session start.

## Product ideas he raised in the session

- Make Finance Control an add-on of the Joserah UI. The direction proposed was a generic "app slot":
  the app stays its own service, and Joserah shows it as a tab with a summary card.
- A Chrome extension for the banks: he logs in himself, and one click sends the visible figures to
  Finance Control. Banks have no API.

## Where the in-session corrections were recorded

`.joserah/learned.md` holds the 07.10 entries: recurring figure from the newest document; verbatim
bank figures written without asking; search the records before asking; silence during a batch; the
documents given are the whole record. Lead also wrote `.joserah/feedback/prompt/2026-10-07-*.md`.
Those entries are generalized for the workspace. **This file keeps the raw case beside them, as
Serkan asked.**

Claude Opus 5.5 — Joserah Orchestrator
