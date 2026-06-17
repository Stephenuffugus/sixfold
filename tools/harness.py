#!/usr/bin/env python3
"""SIXFOLD Monte-Carlo validator.

Ports the validated base engine + the Clash Bind (spec §3.5) and re-proves the
length/fairness/bind targets. Re-run after ANY engine change:

    python3 tools/harness.py

Targets (spec §8, with bind):
  median ~5 rounds, p90 ~7, dead rounds ~19%, reader-vs-random ~50%.
  bind: random ~50/50 decisive, tie ~1/3 of binds, winner deals exactly GLANCE(+esc).
"""
import random
import statistics

N, HP, CLEAN, GLANCE, ESC_ROUND = 6, 4, 2, 1, 6


def resolve(a, b):
    """My pick a vs their pick b. Returns (kind, winner)."""
    d = (b - a) % N
    if d == 0: return ("clash", None)
    if d == 1: return ("clean", "P")
    if d == 2: return ("glance", "P")
    if d == 3: return ("whiff", None)
    if d == 4: return ("glance", "A")
    return ("clean", "A")          # d == 5


def counter(p):
    """Stance that CLEAN-hits p."""
    return (p - 1) % N


# ---- stance strategies: f(own_hist, opp_hist, rng) -> stance ----
def s_random(own, opp, rng):
    return rng.randrange(N)


def s_reader(own, opp, rng):
    """Mirrors the prototype reader: exploit a lean in the opponent's recent picks."""
    recent = opp[-WINDOW:]
    if len(recent) >= 3:
        c = {}
        for x in recent:
            c[x] = c.get(x, 0) + 1
        best = max(c, key=c.get)
        if c[best] / len(recent) > (1 / N) + 0.08:
            return counter(best)
    return rng.randrange(N)


WINDOW = 12


# ---- bind strategies: f(rng) -> 0..2 ----
def b_random(rng):
    return rng.randrange(3)


def play_match(stratP, stratA, rng, bindP=b_random, bindA=b_random):
    hpP = hpA = HP
    histP, histA = [], []
    rounds = dead = binds = bind_ties = bind_p = bind_a = 0
    bind_dmgs = []
    while hpP > 0 and hpA > 0 and rounds < 200:
        rounds += 1
        bump = 1 if rounds > ESC_ROUND else 0
        a = stratP(histP, histA, rng)
        b = stratA(histA, histP, rng)
        histP.append(a)
        histA.append(b)
        kind, win = resolve(a, b)
        if kind == "clash":
            binds += 1
            pB, aB = bindP(rng), bindA(rng)
            d3 = (aB - pB) % 3            # 0 tie, 1 player wins, 2 ai wins
            if d3 == 0:
                bind_ties += 1
                dead += 1                 # harmless spark
            else:
                dmg = GLANCE + bump
                bind_dmgs.append(dmg)
                if d3 == 1:
                    bind_p += 1
                    hpA -= dmg
                else:
                    bind_a += 1
                    hpP -= dmg
        elif kind == "whiff":
            dead += 1
        elif kind == "clean":
            if win == "P": hpA -= CLEAN + bump
            else: hpP -= CLEAN + bump
        elif kind == "glance":
            if win == "P": hpA -= GLANCE + bump
            else: hpP -= GLANCE + bump
    winner = "P" if hpP > 0 else "A"
    return dict(rounds=rounds, dead=dead, winner=winner, binds=binds,
               bind_ties=bind_ties, bind_p=bind_p, bind_a=bind_a,
               bind_dmgs=bind_dmgs)


def pct(x): return f"{100*x:.1f}%"


def run(label, stratP, stratA, n=60000, seed=1):
    rng = random.Random(seed)
    rounds, deads, total_rounds = [], 0, 0
    pwins = binds = ties = bp = ba = 0
    all_bind_dmgs = []
    per_match_dead = []          # mean-of-ratios (spec's reporting basis)
    for _ in range(n):
        r = play_match(stratP, stratA, rng)
        rounds.append(r["rounds"])
        deads += r["dead"]
        total_rounds += r["rounds"]
        per_match_dead.append(r["dead"] / r["rounds"])
        pwins += 1 if r["winner"] == "P" else 0
        binds += r["binds"]; ties += r["bind_ties"]
        bp += r["bind_p"]; ba += r["bind_a"]
        all_bind_dmgs += r["bind_dmgs"]
    rounds.sort()
    med = statistics.median(rounds)
    p90 = rounds[int(0.90 * (len(rounds) - 1))]
    p99 = rounds[int(0.99 * (len(rounds) - 1))]
    dead_ratio = statistics.mean(per_match_dead)   # per-match average
    print(f"\n=== {label}  (n={n}) ===")
    print(f"  rounds  median={med}  p90={p90}  p99={p99}")
    print(f"  dead rounds: {pct(dead_ratio)} per-match  |  {pct(deads/total_rounds)} pooled")
    print(f"  P win-rate:  {pct(pwins/n)}")
    if binds:
        decisive = bp + ba
        print(f"  binds: {binds}  tie={pct(ties/binds)}  "
              f"P/A decisive={pct(bp/decisive)}/{pct(ba/decisive)}")
        dmgset = sorted(set(all_bind_dmgs))
        print(f"  bind win dmg values seen: {dmgset}  (expect {{1}} pre-esc, {{1,2}} with esc)")
    return dict(med=med, p90=p90, p99=p99, dead=dead_ratio,
                dead_pooled=deads/total_rounds,
                pwin=pwins/n, binds=binds, ties=ties, bp=bp, ba=ba)


def baseline_clash_nothing(label, n=60000, seed=2):
    """Control: clash deals nothing (no bind). Should show dead ~28%, p90 ~8."""
    rng = random.Random(seed)
    rounds, per_match_dead = [], []
    for _ in range(n):
        hpP = hpA = HP
        rr = d = 0
        while hpP > 0 and hpA > 0 and rr < 200:
            rr += 1
            bump = 1 if rr > ESC_ROUND else 0
            a, b = rng.randrange(N), rng.randrange(N)
            kind, win = resolve(a, b)
            if kind == "clash": d += 1
            elif kind == "whiff": d += 1
            elif kind == "clean":
                if win == "P": hpA -= CLEAN + bump
                else: hpP -= CLEAN + bump
            elif kind == "glance":
                if win == "P": hpA -= GLANCE + bump
                else: hpP -= GLANCE + bump
        rounds.append(rr); per_match_dead.append(d / rr)
    rounds.sort()
    print(f"\n=== {label}  (n={n}) ===")
    print(f"  rounds  median={statistics.median(rounds)}  "
          f"p90={rounds[int(0.9*(len(rounds)-1))]}  p99={rounds[int(0.99*(len(rounds)-1))]}")
    print(f"  dead rounds: {pct(statistics.mean(per_match_dead))} per-match  "
          f"(spec baseline ~28%)")


if __name__ == "__main__":
    print("SIXFOLD harness — validating engine + Clash Bind\n" + "=" * 48)
    baseline_clash_nothing("CONTROL: clash = nothing (random)")
    run("BIND: random vs random", s_random, s_random)
    run("BIND: reader vs random (fairness)", s_reader, s_random)
    run("BIND: random vs reader (symmetry mirror)", s_random, s_reader)

    print("\n" + "=" * 48)
    print("ACCEPTANCE CHECK (bind, random vs random):")
    r = run("recheck", s_random, s_random, n=60000, seed=7)
    ok = []
    ok.append(("median≈5", r["med"] == 5))
    ok.append(("p90≈7", 6 <= r["p90"] <= 7))
    ok.append(("dead≈19%", 0.17 <= r["dead"] <= 0.21))
    ok.append(("bind tie≈1/3", 0.31 <= r["ties"] / r["binds"] <= 0.36))
    ok.append(("bind decisive≈50/50",
               abs(r["bp"] / (r["bp"] + r["ba"]) - 0.5) < 0.02))
    rf = run("reader-vs-random fairness recheck", s_reader, s_random, n=60000, seed=9)
    ok.append(("reader≈50%", abs(rf["pwin"] - 0.5) < 0.02))
    print("\nRESULTS:")
    allok = True
    for name, passed in ok:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        allok = allok and passed
    print("\n" + ("ALL TARGETS MET ✓" if allok else "SOME TARGETS MISSED ✗"))
