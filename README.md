<img width="1280" height="640" alt="git (1)" src="https://github.com/user-attachments/assets/8920b256-2ba8-4988-b824-5351134eb4bd" />



# Kada 🎯


## Basic Details
### Team Name: Aromal S D (Individual)


### Team Members
- Team Lead: Aromal S D - [College of Engineering Perumon]

**Live at [puffsundo.vercel.app](https://puffsundo.vercel.app)**

### Project Description
Kada is a live availability board for the two places on campus that sell puffs. It tells you
whether anything is left before you walk over. Neither shop has a till, a scanner, or any
inventory system, so the answer is reconstructed from vendor counts and student reports using
weighted consensus with time-decay and per-device reputation.

### The Problem (that doesn't exist)
Every day, students walk all the way to the canteen to discover the puffs are gone. This costs
roughly forty metres of walking and a small amount of dignity. Humanity has tolerated this for
centuries. Nobody has ever asked for it to be fixed, because you could simply, you know, walk
over and look.

### The Solution (that nobody asked for)
We applied Byzantine-fault-tolerant distributed consensus to a ₹12 snack.

Reports from students are treated as untrusted inputs to a scoring model: each one is weighted by
the reporter's Beta-distributed reputation, boosted if their phone confirms they are physically
at the counter, and decayed exponentially with a time constant that tightens during break hours
because puffs move faster at 10:45. The shopkeeper's count, when given, is ground truth and
resets the ledger. The result is a confidence value the interface refuses to overstate — if
nobody knows, it says nobody knows.

It is an enormous amount of statistics to avoid a short walk. It also genuinely works.

## Technical Details
### Technologies/Components Used
For Software:
- **Languages:** TypeScript, SQL (PostgreSQL / PL/pgSQL)
- **Frameworks:** Next.js 16 (App Router), React 19
- **Libraries:** Tailwind CSS v4, Motion, Zod, supabase-js, sonner, lucide-react, Vitest
- **Tools:** Supabase (Postgres, Realtime, RLS), Vercel, GitHub Actions

For Hardware:
- Not applicable — this project is software only.

### Implementation
For Software:

# Installation
```bash
git clone https://github.com/aromalsd/Puffs-undo.git
cd Puffs-undo
npm install
cp .env.local.example .env.local   # then fill in your Supabase values
npm run migrate                    # creates the schema and seeds both outlets
```

# Run
```bash
npm run dev        # http://localhost:3000
npm run test       # scoring engine unit tests
npm run typecheck  # strict TypeScript, no emit
```

### Routes
| Path | What it is |
|---|---|
| `/` | The public board. `?shop=<slug>` opens a specific outlet. |
| `/vendor` | The shop's counter console, behind a PIN. |
| `/stats` | What the board is built from, and how accurate it has been. |
| `/codes` | Printable QR codes to stick at each counter. |

### How it actually works

Availability is never stored as a boolean. Every signal lands in an append-only `reports` ledger
and the derived state is recomputed on write.

**Scoring.** Each report carries a weight fixed at write time: `0.35 × reputation` for a student,
`1.0` for the shop, multiplied by `1.4` when the browser confirms the reporter is within 80 m of
the counter. Weights decay as `w(t) = w₀ · e^(−Δt/τ)`, where `τ` is 8 minutes inside the campus
rush windows and 20 minutes otherwise. The signed sum `S = Σ wᵢ·sᵢ` (`available` = +1,
`low` = +0.2, `sold_out` = −1) yields `confidence = |S| / (|S| + 1.2)`, and the state is
`available` above +0.4, `sold_out` below −0.4, `uncertain` between, and `unknown` when no
surviving weight clears the floor. One person shouting "sold out" therefore moves the board to
*Unclear*, not to *Sold out* — it takes corroboration.

**Reputation.** Every device carries a Beta posterior seeded neutral at (2, 2). When the shop
enters a count, the reports made in the preceding 25 minutes are graded against it and each
reporter's α or β moves. The weight multiplier is the posterior mean, clamped to [0.1, 1.5], so a
persistent liar's influence decays toward nothing without ever being told they were muted.

**Integrity.** Row Level Security is on for every table and the client cannot insert anything:
`reports`, `devices`, `vendor_sessions` and `pin_attempts` have RLS enabled with no policies and
no privileges. All writes go through `SECURITY DEFINER` functions that enforce their own limits —
one report per device per item per 90 seconds, twenty per device per hour, and an IP-hash ceiling
that survives someone clearing their local identifier. Shop access is a bcrypt-hashed PIN,
throttled to five attempts per fifteen minutes.

**Resilience.** The board subscribes to Postgres changes over websockets and falls back to HTTPS
polling automatically when websockets are blocked, which many campus networks do. Because the
scoring model is a pure function shared by client and server, confidence keeps decaying in the
browser between updates with no database load at all.

**Closing the loop.** Reports are graded, so each reporter can see what their word is currently
worth. The shop gets the one figure it cannot observe from behind the counter — how many people
came looking after something had already run out — which is what gives it a reason to keep
entering counts, and the counts are what keep the whole model honest.

### Project Documentation
For Software:

# Screenshots (Add at least 3)
![Screenshot1](Add screenshot 1 here with proper name)
*The public board: derived state, live confidence, and the shop's count where one exists.*

![Screenshot2](Add screenshot 2 here with proper name)
*A single unverified "sold out" moves the item to Unclear rather than flipping it.*

![Screenshot3](Add screenshot 3 here with proper name)
*The counter console: oversized steppers, designed to be usable in three seconds.*

# Diagrams
![Workflow](Add your workflow/architecture diagram here)
*Reports enter an append-only ledger; a trigger collapses them into derived state, which is
pushed to every open client.*

---
Made with ❤️ at TinkerHub Useless Projects 

![Static Badge](https://img.shields.io/badge/TinkerHub-24?color=%23000000&link=https%3A%2F%2Fwww.tinkerhub.org%2F)
![Static Badge](https://img.shields.io/badge/UselessProjects--26-26?link=https%3A%2F%2Ftinkerhub.org%2Fevents%2F1M8ORET9A1%2Fuseless-projects-3.0)
