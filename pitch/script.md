# R-Zero — 3-minute pitch script

454 spoken words, which is 3:02 at 150 a minute — a normal presenting pace, not
a rushed one. The two silences marked **hold** add four seconds on top of that,
so if your cutoff is hard, either lose the holds or take the cut marked at the
bottom, which lands you at 2:46 with room to breathe.

Say the numbers slowly. They are the whole argument.

---

### 0:00 — 0:22 · ON CAMERA, no slide

When I read the track brief I stopped asking "how do I catch more fraud," and
asked something smaller.

What is a fraud analyst actually doing at nine o'clock on a Monday morning?

She opens a queue. There are a hundred transactions in it. She has time for a
hundred.

> **hold** — one beat before the slide comes up.

### 0:22 — 0:42 · SCREEN: review queue, 100 rows, 9 of them red

With a good conventional model, about nine of those hundred are real fraud. The
other ninety-one are people who bought a phone. So she spends her whole shift
clearing the innocent, and the frauds she misses are just the ones that happened
to be number a hundred and one.

### 0:42 — 1:16 · SCREEN: contagion diagram, one event branching into a burst

So I stopped reading fraud papers and went somewhere older. Seismologists have a
model where one earthquake raises the odds of the next, and that excitement
decays. Ogata, 1988, aftershocks.

Fraud does the same thing. A stolen card is not one bad transaction; it is a
first one, then a burst, with a half-life you can measure in minutes. So I built
that half-life as a layer on top of whatever detector is already running, because
nobody rips out their core pipeline for a student's idea.

### 1:16 — 1:34 · SCREEN: 0.090 → 0.890

On five hundred and ninety thousand real transactions, that layer puts
eighty-nine real frauds in her top hundred instead of nine. Which means nine of
every ten clicks land on fraud, and her morning goes from eight and a half hours
of false alarms to one.

### 1:34 — 2:29 · ON CAMERA, quieter, slower

But that is not the part I want to tell you about.

At two in the morning I broke my false alarm rate down by customer instead of by
transaction, and found one innocent account flagged one thousand, one hundred
and seventy-two times.

One person. Same card. Declined again and again by my maths, which was supposed
to be guaranteed.

> **hold** — two full beats. Let that number sit.

I tried eight ways to fix that threshold before morning, and all eight failed on
the same two people. I had been reading my own theorem wrong. A guarantee that
holds once does not hold a thousand times; ask it enough and eventually it says
yes to anybody.

So the threshold was never the thing to fix. What bounds the damage is how long
a wrong decision is allowed to stand.

### 2:29 — 2:44 · SCREEN: review desk, worst-customer counter falling to 5

I put a human back between the decision and its permanence. Same recall, nothing
calibrated, nothing that has to transfer to your data.

That customer went from one thousand, one hundred and seventy-two blocked
payments, to five.

### 2:44 — 3:06 · ON CAMERA

So in short, R-Zero does not try to know more than your fraud team. It makes
sure the hundred rows they can look at are worth looking at, and that when it is
wrong, it is wrong about five payments, not a thousand.

Every experiment that failed is still in the repository.

Including that one.

---

## If you run long, cut this

Drop the 0:22 block whole, and open the next one with "About nine of those
hundred are real fraud. So I stopped reading fraud papers and went somewhere
older." That buys you twenty seconds, keeps the nine-in-a-hundred, and nothing
else in the script has to move.

## Shot list

| Time | On screen |
|---|---|
| 0:00 | You, nothing else |
| 0:22 | Home tab, review-queue interactive, 9 red rows in 100 |
| 0:42 | Home tab, contagion decay diagram — let one burst play through |
| 1:16 | Model tab, top-100 precision bar going 0.090 → 0.890 |
| 1:34 | You, no slide. This section works only on your face |
| 2:29 | Model tab, review-desk panel, worst-customer counter falling to 5 |
| 2:44 | You. The last line lands on you, not on a slide |

## Delivery

The whole script has one job: the judges have to believe the 2 a.m. section is
true. So the first half is brisk and a little proud, and the second half drops
in volume and speed, like you are admitting something rather than presenting it.

Do not smile through "one thousand, one hundred and seventy-two." Say it flat.

The last three lines are three separate sentences on purpose. Full stop, breath,
next one.
