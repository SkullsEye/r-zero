import numpy as np

from rzero.economics import Policy

GENE_NAMES = ["low_review", "low_block", "mid_review", "mid_block",
              "high_review", "high_block", "review_capacity",
              "max_block_fraction", "false_alarm_rate", "miss_rate"]

MAX_QUEUE_FRACTION = 0.10
MIN_BLOCK_FRACTION = 0.001
MAX_BLOCK_FRACTION = 0.05


def decode_policy(genes, n_transactions, score_range=(0.0, 1.0)):
    low, high = score_range
    thresholds = {}
    for index, name in enumerate(Policy.BAND_NAMES):
        review_at = low + genes[2 * index] * (high - low)
        block_at = review_at + genes[2 * index + 1] * (high - review_at)
        thresholds[name] = (float(review_at), float(block_at))

    return Policy(
        thresholds_by_band=thresholds,
        review_capacity=int(round(genes[6] * MAX_QUEUE_FRACTION * n_transactions)),
        max_block_fraction=float(
            MIN_BLOCK_FRACTION + genes[7] * (MAX_BLOCK_FRACTION - MIN_BLOCK_FRACTION)))


def dominates(left, right):
    return np.all(left <= right) and np.any(left < right)


def sort_into_fronts(objectives):
    n = len(objectives)
    dominated_by = [[] for _ in range(n)]
    domination_count = np.zeros(n, dtype=int)
    fronts = [[]]

    for p in range(n):
        for q in range(n):
            if p == q:
                continue
            if dominates(objectives[p], objectives[q]):
                dominated_by[p].append(q)
            elif dominates(objectives[q], objectives[p]):
                domination_count[p] += 1
        if domination_count[p] == 0:
            fronts[0].append(p)

    index = 0
    while fronts[index]:
        following = []
        for p in fronts[index]:
            for q in dominated_by[p]:
                domination_count[q] -= 1
                if domination_count[q] == 0:
                    following.append(q)
        index += 1
        fronts.append(following)

    return [front for front in fronts if front]


def crowding_distance(objectives, front):
    size = len(front)
    if size <= 2:
        return np.full(size, np.inf)

    distance = np.zeros(size)
    for axis in range(objectives.shape[1]):
        values = objectives[front, axis]
        order = np.argsort(values)
        distance[order[0]] = distance[order[-1]] = np.inf
        spread = values[order[-1]] - values[order[0]]
        if spread <= 0:
            continue
        distance[order[1:-1]] += (values[order[2:]] - values[order[:-2]]) / spread

    return distance


def _crossover(first, second, rng, eta=15.0, probability=0.9):
    child_a, child_b = first.copy(), second.copy()
    if rng.random() > probability:
        return child_a, child_b

    for i in range(len(first)):
        if rng.random() > 0.5:
            continue
        u = rng.random()
        beta = ((2 * u) ** (1 / (eta + 1)) if u <= 0.5
                else (1 / (2 * (1 - u))) ** (1 / (eta + 1)))
        child_a[i] = 0.5 * ((1 + beta) * first[i] + (1 - beta) * second[i])
        child_b[i] = 0.5 * ((1 - beta) * first[i] + (1 + beta) * second[i])

    return np.clip(child_a, 0, 1), np.clip(child_b, 0, 1)


def _mutate(genes, rng, eta=20.0):
    mutated = genes.copy()
    probability = 1.0 / len(genes)
    for i in range(len(mutated)):
        if rng.random() >= probability:
            continue
        u = rng.random()
        step = ((2 * u) ** (1 / (eta + 1)) - 1 if u < 0.5
                else 1 - (2 * (1 - u)) ** (1 / (eta + 1)))
        mutated[i] = np.clip(mutated[i] + step, 0, 1)
    return mutated


def evolve_frontier(objective, n_genes, population_size=60, generations=40,
                    seed=0):
    rng = np.random.default_rng(seed)
    population = rng.random((population_size, n_genes))
    objectives = np.array([objective(genes) for genes in population], float)

    def rank_population(objectives):
        fronts = sort_into_fronts(objectives)
        rank = np.empty(len(objectives), dtype=int)
        crowding = np.empty(len(objectives))
        for level, front in enumerate(fronts):
            rank[front] = level
            crowding[front] = crowding_distance(objectives, front)
        return rank, crowding

    rank, crowding = rank_population(objectives)

    for _ in range(generations):
        children = []
        while len(children) < population_size:
            a, b, c, d = rng.integers(0, len(population), 4)
            first = a if (rank[a], -crowding[a]) < (rank[b], -crowding[b]) else b
            second = c if (rank[c], -crowding[c]) < (rank[d], -crowding[d]) else d
            left, right = _crossover(population[first], population[second], rng)
            children += [_mutate(left, rng), _mutate(right, rng)]

        offspring = np.array(children[:population_size])
        offspring_objectives = np.array(
            [objective(genes) for genes in offspring], float)

        pooled = np.vstack([population, offspring])
        pooled_objectives = np.vstack([objectives, offspring_objectives])

        survivors = []
        for front in sort_into_fronts(pooled_objectives):
            if len(survivors) + len(front) <= population_size:
                survivors += front
            else:
                spread = crowding_distance(pooled_objectives, front)
                room = population_size - len(survivors)
                survivors += [front[i] for i in np.argsort(-spread)[:room]]
                break

        population = pooled[survivors]
        objectives = pooled_objectives[survivors]
        rank, crowding = rank_population(objectives)

    return population, objectives, sort_into_fronts(objectives)[0]


def hypervolume(objectives, reference=None):
    objectives = np.asarray(objectives, float)
    if objectives.shape[1] != 2 or len(objectives) == 0:
        return float("nan")

    reference = objectives.max(axis=0) + 1e-9 if reference is None else reference
    inside = objectives[np.all(objectives <= reference, axis=1)]
    if not len(inside):
        return 0.0

    inside = inside[np.argsort(inside[:, 0])]
    volume, ceiling = 0.0, reference[1]
    for x, y in inside:
        if y < ceiling:
            volume += (reference[0] - x) * (ceiling - y)
            ceiling = y
    return float(volume)


def frontier_quality(objectives, front):
    points = np.asarray(objectives)[front]
    if len(points) < 2:
        return {"count": len(points), "spacing": float("nan"), "extent": 0.0}

    spans = points.max(axis=0) - points.min(axis=0)
    spans[spans == 0] = 1.0
    scaled = points / spans
    scaled = scaled[np.argsort(scaled[:, 0])]
    gaps = np.linalg.norm(np.diff(scaled, axis=0), axis=1)

    return {
        "count": int(len(points)),
        "spacing": float(np.std(gaps)),
        "extent": float(np.linalg.norm(scaled[-1] - scaled[0])),
    }
