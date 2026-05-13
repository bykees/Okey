# game_logic.py
import random
from collections import Counter
from itertools import combinations, product

TURN_TIMEOUT = 15  


# ---------------------------
# DESTE / DAĞITIM
# ---------------------------
def create_deck():
    tiles = []
    colors = ['K', 'M', 'S', 'Y']
    for color in colors:
        for number in range(1, 14):
            tiles.append(f"{color}{number}")
            tiles.append(f"{color}{number}")
    tiles.append("✦")
    tiles.append("✦")
    random.shuffle(tiles)
    return tiles


def deal_tiles(room, starter=None):
    players = room['players']
    deck = room['deck']
    hands = {nick: [] for nick in players}

    for _ in range(14):
        for nick in players:
            if deck:
                hands[nick].append(deck.pop())

    if starter is None:
        starter = room['host']

    if deck and starter in hands:
        hands[starter].append(deck.pop())

    for nick in players:
        hands[nick].extend(["0"] * 17)

    room['hands'] = hands


# ---------------------------
# GÖSTERGE / OKEY
# ---------------------------
def draw_indicator(deck):
    """Gösterge SJ olamaz. Deck'ten SJ gelirse en alta atıp devam eder."""
    tries = 0
    while deck and tries < 10000:
        t = deck.pop()
        if t not in ("✦", "✦"):
            return t
        deck.insert(0, t)
        tries += 1
    return None


def next_number(n: int) -> int:
    return 1 if n == 13 else n + 1


def determine_okey_from_indicator(indicator_tile: str):
    """Gösterge K7 -> okey K8, K13 -> K1"""
    if not indicator_tile or indicator_tile in ("✦", "✦"):
        return None
    color = indicator_tile[0]
    num = int(indicator_tile[1:])
    return f"{color}{next_number(num)}"


# ---------------------------
# PER / BİTİRME KONTROLÜ
# ---------------------------
def _decode_tile(tile: str):
    """'K7' -> ('K', 7). SJ burada decode edilmez."""
    if not tile or tile == "0":
        return None
    if tile in ("✦", "✦"):
        return None
    color = tile[0]
    try:
        number = int(tile[1:])
    except ValueError:
        return None
    return (color, number)


def _remove_zeros(counter: Counter) -> Counter:
    return Counter({k: v for k, v in counter.items() if v > 0})


def _can_form_melds_plain(counts: Counter) -> bool:
    """Jokersız klasik çözüm (3+ seri, 3-4 grup)."""
    counts = _remove_zeros(counts)
    if not counts:
        return True

    (color, number), _ = min(counts.items(), key=lambda kv: (kv[0][0], kv[0][1]))

    all_colors = ['K', 'M', 'S', 'Y']
    available = [c for c in all_colors if counts.get((c, number), 0) > 0]

    for size in (3, 4):
        for comb in combinations(available, size):
            if color not in comb:
                continue
            new_counts = counts.copy()
            ok = True
            for c in comb:
                k = (c, number)
                if new_counts[k] <= 0:
                    ok = False
                    break
                new_counts[k] -= 1
            if ok and _can_form_melds_plain(new_counts):
                return True

    max_len = 0
    while counts.get((color, number + max_len), 0) > 0:
        max_len += 1

    for length in range(3, max_len + 1):
        new_counts = counts.copy()
        ok = True
        for v in range(number, number + length):
            k = (color, v)
            if new_counts[k] <= 0:
                ok = False
                break
            new_counts[k] -= 1
        if ok and _can_form_melds_plain(new_counts):
            return True

    return False


def _can_form_melds_with_jokers(counts: Counter, jokers: int, memo: dict) -> bool:
    """
    Jokersız per çözümüne joker eklenmiş hali.
    Jokeri burada “eksik taşı tamamlamak” gibi kullanıyoruz.
    """
    counts = _remove_zeros(counts)
    key = (tuple(sorted(counts.items())), jokers)
    if key in memo:
        return memo[key]

    if not counts:
        memo[key] = True
        return True

    if jokers < 0:
        memo[key] = False
        return False

    if _can_form_melds_plain(counts):
        memo[key] = True
        return True

    (color, number), _ = min(counts.items(), key=lambda kv: (kv[0][0], kv[0][1]))

    all_colors = ['K', 'M', 'S', 'Y']
    other_colors = [c for c in all_colors if c != color]

    for size in (3, 4):
        new_counts = counts.copy()
        if new_counts[(color, number)] <= 0:
            continue
        new_counts[(color, number)] -= 1

        for comb in combinations(other_colors, size - 1):
            tmp = new_counts.copy()
            use_j = 0
            ok = True
            for c in comb:
                k2 = (c, number)
                if tmp.get(k2, 0) > 0:
                    tmp[k2] -= 1
                else:
                    use_j += 1
                    if use_j > jokers:
                        ok = False
                        break
            if not ok:
                continue
            if _can_form_melds_with_jokers(tmp, jokers - use_j, memo):
                memo[key] = True
                return True

    for length in range(3, 14):
        tmp = counts.copy()
        use_j = 0

        for v in range(number, number + length):
            k2 = (color, v)
            if tmp.get(k2, 0) > 0:
                tmp[k2] -= 1
            else:
                use_j += 1
                if use_j > jokers:
                    break
        else:
            if _can_form_melds_with_jokers(tmp, jokers - use_j, memo):
                memo[key] = True
                return True

    memo[key] = False
    return False


def _can_finish_with_pairs(counts: Counter, jokers: int) -> bool:
    """
    7 çift (14 taş) kontrolü.
    - counts: joker olmayan taşlar
    - jokers: okey joker adedi (tek taşları tamamlar)
    """
    counts = _remove_zeros(counts)
    if sum(counts.values()) + jokers not in (14, 15):
        return False

    singles = sum(v % 2 for v in counts.values())
    if singles > jokers:
        return False

    jokers_left = jokers - singles
    pair_count = sum(v // 2 for v in counts.values()) + singles + (jokers_left // 2)
    return pair_count == 7


def is_valid_win_hand(hand, okey_tile=None) -> bool:
    real_tiles = [t for t in hand if t != "0"]

    if len(real_tiles) not in (14, 15):
        return False

    jokers = 0
    decoded = []

    for t in real_tiles:
        if okey_tile and t == okey_tile:
            jokers += 1
            continue

        if t in ("✦", "✦"):
            if not okey_tile:
                return False
            d_okey = _decode_tile(okey_tile)
            if d_okey is None:
                return False
            decoded.append(d_okey)
            continue

        d = _decode_tile(t)
        if d is None:
            return False
        decoded.append(d)

    if _can_finish_with_pairs(Counter(decoded), jokers):
        return True

    ones_indices = [i for i, (_, n) in enumerate(decoded) if n == 1]

    if not ones_indices:
        return _can_form_melds_with_jokers(Counter(decoded), jokers, memo={})

    k = len(ones_indices)
    for mask in product((0, 1), repeat=k):
        variant = list(decoded)
        for bit_idx, tile_idx in enumerate(ones_indices):
            c, _ = variant[tile_idx]
            variant[tile_idx] = (c, 14 if mask[bit_idx] == 1 else 1)

        if _can_form_melds_with_jokers(Counter(variant), jokers, memo={}):
            return True

    return False
