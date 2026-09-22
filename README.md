# SvelteReads

A modern, high-performance book discovery and community review platform built with SvelteKit 2, Svelte 5 Runes, Tailwind CSS v4, and Firebase.

- Live Application: [https://svelte-reads.vercel.app](https://svelte-reads.vercel.app)
- Stack: SvelteKit 2 + Svelte 5 (Runes) + Tailwind CSS v4 + Firebase 11 (Emulator-Ready)

---

## Why SvelteReads?

Goodreads is bloated, slow, and constrained by 2000s-era table layouts. SvelteReads is engineered as an editorial, high-retention alternative:

1. Mathematically Honest Ranking: Replaces naive arithmetic averages with a Bayesian weighted score ($WR = \frac{v}{v + m} \times R + \frac{m}{v + m} \times C$) so single 5-star submissions cannot outrank classics with thousands of reviews.
2. Fine-Grained Reactivity: Built on Svelte 5 Runes (`$state`, `$derived`, `$effect`) for sub-millisecond UI updates with zero VDOM overhead.
3. Deterministic Shelf Transitions: Pure state-machine engine governing reading statuses (`want-to-read`, `currently-reading`, `read`, `did-not-finish`) with immutable timestamping and progress math.
4. Mobile-First & Touch Certified: Engineered without desktop hover dependencies. Every button, slider, and selector satisfies strict 44x44px touch targets across 360px, 390px, 430px, and 768px viewports.
5. Zero-Layout-Shift Spoiler Guards: Spoiler reviews stay masked behind accessible, blur-shielded containers that prevent layout shifts and keep hidden text out of the accessibility tree until explicitly revealed.
6. 100% Local Development: Complete Firebase Emulator Suite (Auth, Firestore, Storage, UI Hub) running locally via Docker Compose. No cloud credentials required to develop or test.

---

## System Architecture

```
src/
├── app.css                         # Tailwind v4 theme, custom dark variant, safe-area utilities
├── lib/
│   ├── components/
│   │   ├── atoms/                  # Touch-certified primitives (Button, RatingStars, Avatar, Badge)
│   │   ├── molecules/              # Feature compounds (BookCardClean, ShelfSelector, SpoilerGuard)
│   │   └── shells/                 # Shell wrappers (AppHeader, MobileBottomNav, EmptyState)
│   ├── data/                       # Typed Firestore gateways with optimistic rollback & retries
│   ├── design/                     # Metrics contracts for 44px mobile touch targets & typography
│   ├── firebase/                   # Client bootstrap with automatic Docker emulator detection
│   ├── state/                      # Reactive Svelte 5 Runes stores (Auth, Shelf, Review, Catalog)
│   ├── types/                      # Domain models (Book, UserProfile, UserBookShelf, Review)
│   ├── utils/                      # Pure functional algorithms (Bayesian rating, shelf state machine)
│   └── validation/                 # Zod schemas with protocol & ISBN sanitization
└── routes/
    ├── +layout.svelte              # Universal shell with layout-shift prevention
    ├── +page.svelte                # Discovery catalog & reading goal widget
    ├── books/[id]/+page.svelte     # Editorial book details, Bayesian breakdown & reviews
    ├── my-books/+page.svelte       # Shelf management with grid/table views & progress sliders
    ├── profile/+page.svelte        # Reader profile, annual challenge, and session credentials
    └── search/+page.svelte         # Single-debounce query filtering & deep-linkable URLs
```

---

## Technical Highlights

### 1. Bayesian Weighted Rating Formula
Standard average ratings suffer from severe sample bias. SvelteReads computes Bayesian community scores in real time:

```typescript
export function calculateBayesianRating(
  ratingsCount: number,
  averageRating: number,
  minThreshold: number = 25,
  catalogMean: number = 3.75
): number {
  if (ratingsCount <= 0 || averageRating <= 0) return 0;
  const weighted =
    (ratingsCount / (ratingsCount + minThreshold)) * averageRating +
    (minThreshold / (ratingsCount + minThreshold)) * catalogMean;
  return Math.round((weighted + Number.EPSILON) * 100) / 100;
}
```

### 2. State Machine Shelf Transitions
Shelf mutations are governed by pure state transitions:

- Starting a book stamps `startedAt` and leaves `finishedAt` null.
- Finishing a book stamps `finishedAt` and locks progress to 100%.
- Returning a book to Want to Read clears reading progress.
- Reaching the final page via the progress slider auto-completes the book.

### 3. Tier-1 Security Rules
- Immutable Metadata: Clients cannot overwrite book titles, authors, or ISBNs.
- Transactional Aggregates: Catalog rating updates are authorized only when bundled with verified user shelf writes.
- Atomic Review Voting: Review likes enforce `!exists() && existsAfter()` checks to prevent infinite like inflation or unauthorized vote manipulation.
- Raster-Only Storage: Cloud Storage uploads reject executable SVG files to eliminate stored XSS vectors.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js >= 22.18
- pnpm >= 9.x
- Docker & Docker Compose

### 1. Clone & Install
```bash
git clone https://github.com/your-username/svelte-reads.git
cd svelte-reads
pnpm install
```

### 2. Start Local Firebase Emulators
```bash
pnpm run emulator:up
```
The Firebase Emulator Suite will be accessible at:
- Emulator UI: `http://localhost:4000`
- Firestore: `http://localhost:8080`
- Auth: `http://localhost:9099`
- Storage: `http://localhost:9199`

### 3. Seed Catalog & Start Dev Server
```bash
pnpm run emulator:seed
pnpm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Verification & Testing

```bash
# Run unit and contract test suites
pnpm test

# Run integration tests against the live Docker emulator
pnpm run test:emulator

# Run full TypeScript and Svelte diagnostics
pnpm run check

# Run Chrome DevTools Protocol mobile geometry certifications
pnpm run verify:atoms
pnpm run verify:molecules
pnpm run verify:shell
```

---

## Production Build

```bash
pnpm run build
pnpm run preview
```

---

## License

MIT
