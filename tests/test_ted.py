"""
Unit tests for the Type-Aware Tree Edit Distance system.

Run with:  python -m pytest tests/test_ted.py -v
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ted.node import Node
from ted.tree_builder import build_tree, build_country_tree, tree_size
from ted.cost_functions import (
    CostFunction,
    numeric_cost,
    string_cost,
    list_cost,
    l1_distribution_cost,
    sharpen,
    MISSING_VALUE,
    _LN_SCALE,
)
from ted.zhang_shasha import zhang_shasha, _postorder, _leftmost_leaf, _keyroots
from ted.similarity import ted_similarity, _to_similarity, max_ted_cost


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def make_num(label: str, value: float) -> Node:
    return Node(label=label, node_type="num", value=value)

def make_str(label: str, value: str) -> Node:
    return Node(label=label, node_type="str", value=value)

def make_list(label: str, value: list) -> Node:
    return Node(label=label, node_type="list", value=value)

def make_dist(label: str, value: dict) -> Node:
    return Node(label=label, node_type="dist", value=value)

def make_dict(*children, label: str = "root") -> Node:
    node = Node(label=label, node_type="dict")
    for child in children:
        node.add_child(child)
    return node


# ────────────────────────────────────────────────────────────────────────────
# 1. Primitive cost functions
# ────────────────────────────────────────────────────────────────────────────

class TestNumericCost:
    def test_identical(self):
        assert numeric_cost(100.0, 100.0) == 0.0

    def test_missing_first(self):
        assert numeric_cost(MISSING_VALUE, 50.0) == 0.5

    def test_missing_second(self):
        assert numeric_cost(50.0, MISSING_VALUE) == 0.5

    def test_both_missing(self):
        assert numeric_cost(MISSING_VALUE, MISSING_VALUE) == 0.5

    def test_log_based_10x_ratio(self):
        # 10× ratio → |ln(10)| / ln(100) = ln(10)/ln(100) = 0.5
        cost = numeric_cost(10.0, 100.0)
        expected = math.log(10) / math.log(100)
        assert abs(cost - expected) < 1e-9

    def test_log_based_100x_ratio(self):
        # 100× ratio → cost = 1.0
        cost = numeric_cost(1.0, 100.0)
        assert abs(cost - 1.0) < 1e-9

    def test_log_based_2x_ratio(self):
        # 2× ratio → |ln(2)| / ln(100) ≈ 0.150
        cost = numeric_cost(50.0, 100.0)
        expected = math.log(2) / math.log(100)
        assert abs(cost - expected) < 1e-9

    def test_cost_clamped_to_one(self):
        cost = numeric_cost(1.0, 1e10)
        assert cost <= 1.0

    def test_zero_value_fallback_to_linear(self):
        # Water (%) = 0 in some countries → linear fallback
        cost = numeric_cost(0.0, 5.0)
        assert 0.0 < cost <= 1.0

    def test_similar_values_cheap(self):
        # 1.05× ratio should be very cheap
        cost = numeric_cost(100.0, 105.0)
        assert cost < 0.03

    def test_very_different_values_expensive(self):
        # 500× ratio → capped at 1.0
        cost = numeric_cost(1.0, 500.0)
        assert cost == 1.0

    def test_hdi_close(self):
        # 0.9 vs 0.95 → ln(0.95/0.9)/ln(100) ≈ 0.012 (very cheap)
        cost = numeric_cost(0.9, 0.95)
        assert cost < 0.02

    def test_hdi_far(self):
        # 0.414 vs 0.938: ln(0.938/0.414)/ln(100) ≈ 0.178
        cost = numeric_cost(0.414, 0.938)
        expected = abs(math.log(0.414) - math.log(0.938)) / _LN_SCALE
        assert abs(cost - expected) < 1e-9


class TestStringCost:
    def test_identical(self):
        assert string_cost("Federal Republic", "Federal Republic") == 0.0

    def test_completely_different(self):
        assert string_cost("alpha", "beta") == 1.0

    def test_partial_overlap(self):
        # Jaccard = 1/3 → cost = 2/3
        cost = string_cost("Federal Republic", "Federal Monarchy")
        assert abs(cost - 2 / 3) < 1e-9

    def test_case_insensitive(self):
        assert string_cost("Democracy", "democracy") == 0.0

    def test_empty_both(self):
        assert string_cost("", "") == 0.0


class TestListCost:
    def test_identical(self):
        assert list_cost(["English"], ["English"]) == 0.0

    def test_disjoint(self):
        assert list_cost(["Dari", "Pashto"], ["English"]) == 1.0

    def test_partial_overlap(self):
        cost = list_cost(["Dari", "Pashto", "English"], ["Dari", "Pashto"])
        assert abs(cost - 1 / 3) < 1e-9

    def test_case_insensitive(self):
        assert list_cost(["English"], ["english"]) == 0.0

    def test_empty_both(self):
        assert list_cost([], []) == 0.0

    def test_same_language_shared(self):
        # French in both Lebanon and Switzerland
        assert list_cost(["French", "Arabic"], ["French", "German"]) < 1.0


class TestL1DistributionCost:
    def test_identical(self):
        d = {"Islam (%)": 99.9, "Other (%)": 0.1}
        assert l1_distribution_cost(d, d) == 0.0

    def test_completely_disjoint(self):
        # d1 sums to 100, d2 has a different single key summing to 100
        # L1 = (100 + 100) / 200 = 1.0
        d1 = {"A (%)": 100.0}
        d2 = {"B (%)": 100.0}
        assert abs(l1_distribution_cost(d1, d2) - 1.0) < 1e-9

    def test_partial_overlap(self):
        d1 = {"A (%)": 60.0, "B (%)": 40.0}
        d2 = {"A (%)": 40.0, "B (%)": 60.0}
        # L1 = |60-40| + |40-60| = 40, /200 = 0.2
        assert abs(l1_distribution_cost(d1, d2) - 0.2) < 1e-9

    def test_missing_key(self):
        d1 = {"A (%)": 100.0}
        d2 = {"A (%)": 60.0, "B (%)": 40.0}
        # L1 = |100-60| + |0-40| = 80, /200 = 0.4
        assert abs(l1_distribution_cost(d1, d2) - 0.4) < 1e-9

    def test_unknown_key(self):
        # Australia ethnic groups style
        d1 = {"Unknown": 100.0}
        d2 = {"Han Chinese (%)": 91.0, "Other (%)": 9.0}
        # L1 = 100 + 91 + 9 = 200, /200 = 1.0
        assert abs(l1_distribution_cost(d1, d2) - 1.0) < 1e-9

    def test_symmetric(self):
        d1 = {"Islam (%)": 53.0, "Christianity (%)": 41.0, "Other (%)": 6.0}
        d2 = {"Christianity (%)": 65.0, "No religion (%)": 30.0, "Other (%)": 5.0}
        assert abs(l1_distribution_cost(d1, d2) - l1_distribution_cost(d2, d1)) < 1e-9


# ────────────────────────────────────────────────────────────────────────────
# 2. Tree construction
# ────────────────────────────────────────────────────────────────────────────

class TestBuildTree:
    def test_num_leaf(self):
        node = build_tree(42.0, "pop")
        assert node.node_type == "num"
        assert node.value == 42.0
        assert node.is_leaf()

    def test_str_leaf(self):
        node = build_tree("Republic", "gov")
        assert node.node_type == "str"

    def test_list_leaf(self):
        node = build_tree(["English", "French"], "lang")
        assert node.node_type == "list"
        assert node.is_leaf()

    def test_dict_becomes_internal(self):
        data = {"Area": 100.0, "Water": 5.0}
        node = build_tree(data, "Geography")
        assert node.node_type == "dict"
        assert not node.is_leaf()
        assert len(node.children) == 2

    def test_religion_becomes_dist(self):
        data = {"Islam (%)": 53.0, "Christianity (%)": 41.0, "Other (%)": 6.0}
        node = build_tree(data, "Religion")
        assert node.node_type == "dist"
        assert node.is_leaf()
        assert node.value == data

    def test_ethnic_groups_becomes_dist(self):
        # Australia-style: "Unknown" key, no "(%)"; detected by label
        data = {"Unknown": 100.0}
        node = build_tree(data, "Ethnic groups")
        assert node.node_type == "dist"
        assert node.is_leaf()

    def test_percentage_dict_becomes_dist_by_key_pattern(self):
        data = {"A (%)": 60.0, "B (%)": 40.0}
        node = build_tree(data, "SomeCustomLabel")
        assert node.node_type == "dist"

    def test_gdp_dict_stays_dict(self):
        # Keys don't end with "(%)"; label not in distribution labels
        data = {"Per capita ($)": 1000.0, "Total ($)": 1e12}
        node = build_tree(data, "GDP ( PPP )")
        assert node.node_type == "dict"
        assert not node.is_leaf()

    def test_country_tree_root_label(self):
        doc = {
            "country": "Testland",
            "infobox": {"Population": {"Count": 1e6}},
        }
        tree = build_country_tree(doc)
        assert tree.label == "infobox"
        assert tree.node_type == "dict"

    def test_tree_size(self):
        root = make_dict(make_num("a", 1.0), make_num("b", 2.0), label="root")
        assert tree_size(root) == 3  # root + 2 leaves


# ────────────────────────────────────────────────────────────────────────────
# 3. Zhang-Shasha indexing helpers
# ────────────────────────────────────────────────────────────────────────────

class TestPostorderAndLD:
    def test_single_node(self):
        root = make_num("x", 1.0)
        po = _postorder(root)
        assert len(po) == 1

    def test_two_children(self):
        root = make_dict(make_num("A", 1.0), make_num("B", 2.0), label="root")
        po = _postorder(root)
        assert [n.label for n in po] == ["A", "B", "root"]

    def test_leftmost_leaf_simple(self):
        root = make_dict(make_num("A", 1.0), make_num("B", 2.0), label="root")
        po = _postorder(root)
        ld = _leftmost_leaf(po)
        assert ld[1] == 1
        assert ld[2] == 2
        assert ld[3] == 1

    def test_keyroots_simple(self):
        root = make_dict(make_num("A", 1.0), make_num("B", 2.0), label="root")
        po = _postorder(root)
        ld = _leftmost_leaf(po)
        kr = _keyroots(ld, len(po))
        assert set(kr) == {2, 3}


# ────────────────────────────────────────────────────────────────────────────
# 4. Sharpening S-curve
# ────────────────────────────────────────────────────────────────────────────

class TestSharpen:
    def test_fixed_points(self):
        assert sharpen(0.0, 3) == 0.0
        assert sharpen(1.0, 3) == 1.0
        assert abs(sharpen(0.5, 3) - 0.5) < 1e-9

    def test_compresses_small(self):
        for x in [0.05, 0.1, 0.2, 0.3, 0.4]:
            assert sharpen(x, 3) < x

    def test_amplifies_large(self):
        for x in [0.6, 0.7, 0.8, 0.9, 0.95]:
            assert sharpen(x, 3) > x

    def test_monotone(self):
        vals = [i / 100 for i in range(101)]
        sharpened = [sharpen(v, 3) for v in vals]
        assert all(sharpened[i] <= sharpened[i + 1] for i in range(100))

    def test_degree5_more_aggressive(self):
        assert sharpen(0.1, 5) < sharpen(0.1, 3)
        assert sharpen(0.9, 5) > sharpen(0.9, 3)

    def test_linear_passthrough(self):
        for x in [0.0, 0.25, 0.5, 0.75, 1.0]:
            assert abs(sharpen(x, 1) - x) < 1e-9

    def test_clamps(self):
        assert sharpen(-0.5, 3) == 0.0
        assert sharpen(1.5,  3) == 1.0


# ────────────────────────────────────────────────────────────────────────────
# 5. Zhang-Shasha correctness
# ────────────────────────────────────────────────────────────────────────────

cost_fn        = CostFunction()           # sharpness=3 (smoothstep)
cost_fn_linear = CostFunction(sharpness=1)


class TestZhangShasha:

    def test_identical_leaf(self):
        t = make_num("x", 5.0)
        assert zhang_shasha(t, t, cost_fn) == 0.0

    def test_identical_tree(self):
        t1 = make_dict(make_num("A", 1.0), make_num("B", 2.0))
        t2 = make_dict(make_num("A", 1.0), make_num("B", 2.0))
        assert zhang_shasha(t1, t2, cost_fn) == 0.0

    def test_single_insert(self):
        t1 = make_dict(make_num("A", 1.0), label="root")
        t2 = make_dict(make_num("A", 1.0), make_num("B", 2.0), label="root")
        assert abs(zhang_shasha(t1, t2, cost_fn) - 1.0) < 1e-9

    def test_single_delete(self):
        t1 = make_dict(make_num("A", 1.0), make_num("B", 2.0), label="root")
        t2 = make_dict(make_num("A", 1.0), label="root")
        assert abs(zhang_shasha(t1, t2, cost_fn) - 1.0) < 1e-9

    def test_label_mismatch_forces_del_ins(self):
        t1 = make_dict(make_num("A", 1.0), label="root")
        t2 = make_dict(make_num("B", 1.0), label="root")
        assert abs(zhang_shasha(t1, t2, cost_fn) - 2.0) < 1e-9

    def test_num_update_cost_log_based(self):
        # 10× ratio (10 vs 100) → raw = ln(10)/ln(100) = 0.5
        # After smoothstep: sharpen(0.5) = 0.5
        t1 = make_dict(make_num("x", 10.0), label="root")
        t2 = make_dict(make_num("x", 100.0), label="root")
        dist = zhang_shasha(t1, t2, cost_fn)
        expected = sharpen(math.log(10) / math.log(100), 3)
        assert abs(dist - expected) < 1e-6

    def test_sharpened_cheaper_for_small_diff(self):
        # 90 vs 100 → small log ratio → sharpened even cheaper
        t1 = make_dict(make_num("x", 90.0), label="root")
        t2 = make_dict(make_num("x", 100.0), label="root")
        assert zhang_shasha(t1, t2, cost_fn) < zhang_shasha(t1, t2, cost_fn_linear)

    def test_sharpened_more_severe_for_large_diff(self):
        # 2 vs 100 → raw ≈ 0.85 → sharpen(0.85) > 0.85
        t1 = make_dict(make_num("x", 2.0), label="root")
        t2 = make_dict(make_num("x", 100.0), label="root")
        assert zhang_shasha(t1, t2, cost_fn) > zhang_shasha(t1, t2, cost_fn_linear)

    def test_str_update_cost(self):
        # "Federal Republic" vs "Federal Monarchy" → raw = 2/3
        t1 = make_dict(make_str("gov", "Federal Republic"), label="root")
        t2 = make_dict(make_str("gov", "Federal Monarchy"), label="root")
        dist = zhang_shasha(t1, t2, cost_fn)
        expected = sharpen(2 / 3, degree=3)
        assert abs(dist - expected) < 1e-6

    def test_list_update_cost_disjoint(self):
        t1 = make_dict(make_list("lang", ["Dari", "Pashto"]), label="root")
        t2 = make_dict(make_list("lang", ["English"]), label="root")
        assert abs(zhang_shasha(t1, t2, cost_fn) - 1.0) < 1e-6

    def test_dist_node_update_cost(self):
        # Islam-dominated vs Christian-dominated religion
        d1 = {"Islam (%)": 99.9, "Other (%)": 0.1}
        d2 = {"Christianity (%)": 65.0, "No religion (%)": 30.0, "Other (%)": 5.0}
        t1 = make_dict(make_dist("Religion", d1), label="root")
        t2 = make_dict(make_dist("Religion", d2), label="root")
        dist = zhang_shasha(t1, t2, cost_fn)
        # L1 raw ≈ (99.9 + 0.1 + 65 + 30 + 5 - 5) / 200 ≈ 195/200 = 0.975
        # After sharpen: very high
        assert dist > 0.9

    def test_dist_node_identical(self):
        d = {"Islam (%)": 53.0, "Christianity (%)": 41.0, "Other (%)": 6.0}
        t1 = make_dict(make_dist("Religion", d), label="root")
        t2 = make_dict(make_dist("Religion", d), label="root")
        assert zhang_shasha(t1, t2, cost_fn) == 0.0

    def test_dict_node_cost_zero(self):
        inner1 = make_dict(make_num("x", 1.0), label="inner")
        inner2 = make_dict(make_num("x", 1.0), label="inner")
        t1 = make_dict(inner1, label="root")
        t2 = make_dict(inner2, label="root")
        assert zhang_shasha(t1, t2, cost_fn) == 0.0

    def test_missing_value_partial_cost(self):
        t1 = make_dict(make_num("Gini", -1.0), label="root")
        t2 = make_dict(make_num("Gini", 32.4), label="root")
        dist = zhang_shasha(t1, t2, cost_fn)
        assert abs(dist - 0.5) < 1e-9

    def test_symmetry(self):
        t1 = make_dict(make_num("A", 10.0), make_str("B", "hello"), label="root")
        t2 = make_dict(make_num("A", 20.0), make_str("C", "world"), label="root")
        assert abs(zhang_shasha(t1, t2, cost_fn) - zhang_shasha(t2, t1, cost_fn)) < 1e-9

    def test_triangle_inequality(self):
        t1 = make_dict(make_num("x", 1.0), label="root")
        t2 = make_dict(make_num("x", 10.0), label="root")
        t3 = make_dict(make_num("x", 100.0), label="root")
        d12 = zhang_shasha(t1, t2, cost_fn)
        d23 = zhang_shasha(t2, t3, cost_fn)
        d13 = zhang_shasha(t1, t3, cost_fn)
        assert d13 <= d12 + d23 + 1e-9


# ────────────────────────────────────────────────────────────────────────────
# 6. Similarity conversion
# ────────────────────────────────────────────────────────────────────────────

cost_fn_default = CostFunction()
_t1 = make_dict(make_num("x", 1.0), label="root")
_t2 = make_dict(make_num("x", 100.0), label="root")


class TestSimilarityConversion:
    def test_zero_distance_gives_one(self):
        t = make_dict(make_num("x", 1.0), label="root")
        for m in ["exp", "inv", "norm", "exp_size"]:
            assert _to_similarity(0.0, t, t, cost_fn_default, m) == 1.0

    def test_exp_size_in_range(self):
        dist = zhang_shasha(_t1, _t2, cost_fn_default)
        sim  = _to_similarity(dist, _t1, _t2, cost_fn_default, "exp_size")
        assert 0.0 < sim < 1.0

    def test_exp_size_normalises_by_tree_size(self):
        # Larger trees with same distance → lower similarity (harder to achieve)
        dist = 2.0
        small = make_dict(make_num("a", 1.0), label="root")            # size 2
        big   = make_dict(                                               # size 4
            make_num("a", 1.0), make_num("b", 2.0), make_num("c", 3.0),
            label="root",
        )
        sim_small = _to_similarity(dist, small, small, cost_fn_default, "exp_size")
        sim_big   = _to_similarity(dist, big,   big,   cost_fn_default, "exp_size")
        # Same distance but bigger trees → distance is a smaller fraction → higher sim
        assert sim_big > sim_small

    def test_max_ted_cost_upper_bound(self):
        upper = max_ted_cost(_t1, _t2, cost_fn_default)
        dist  = zhang_shasha(_t1, _t2, cost_fn_default)
        assert dist <= upper + 1e-9

    def test_unknown_method_raises(self):
        t = make_dict(make_num("x", 1.0), label="root")
        with pytest.raises(ValueError):
            _to_similarity(1.0, t, t, cost_fn_default, "unknown")


# ────────────────────────────────────────────────────────────────────────────
# 7. End-to-end: real country data
# ────────────────────────────────────────────────────────────────────────────

DATA_DIR = os.path.join(
    os.path.dirname(__file__), "..", "Data", "Wiki Infobox", "JSON"
)


def _load(country: str) -> dict:
    path = os.path.join(DATA_DIR, f"{country}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.skipif(not os.path.isdir(DATA_DIR), reason="Data directory not found")
class TestRealCountries:

    def test_same_country_zero_distance(self):
        tree = build_country_tree(_load("australia"))
        dist, sim = ted_similarity(tree, tree)
        assert dist == 0.0
        assert sim == 1.0

    def test_religion_is_dist_node(self):
        tree = build_country_tree(_load("afghanistan"))
        def find(root, label):
            if root.label == label:
                return root
            for c in root.children:
                found = find(c, label)
                if found:
                    return found
        religion = find(tree, "Religion")
        assert religion is not None
        assert religion.node_type == "dist"

    def test_ethnic_groups_is_dist_node(self):
        tree = build_country_tree(_load("australia"))
        def find(root, label):
            if root.label == label:
                return root
            for c in root.children:
                found = find(c, label)
                if found:
                    return found
        ethnic = find(tree, "Ethnic groups")
        assert ethnic is not None
        assert ethnic.node_type == "dist"

    def test_distance_is_nonnegative(self):
        t_af = build_country_tree(_load("afghanistan"))
        t_au = build_country_tree(_load("australia"))
        dist, sim = ted_similarity(t_af, t_au)
        assert dist >= 0.0
        assert 0.0 < sim <= 1.0

    def test_similar_pair_higher_than_dissimilar(self):
        """Germany-Austria > Germany-Afghanistan"""
        t_de = build_country_tree(_load("germany"))
        t_at = build_country_tree(_load("austria"))
        t_af = build_country_tree(_load("afghanistan"))
        _, sim_close = ted_similarity(t_de, t_at)
        _, sim_far   = ted_similarity(t_de, t_af)
        assert sim_close > sim_far

    def test_symmetry(self):
        t1 = build_country_tree(_load("afghanistan"))
        t2 = build_country_tree(_load("albania"))
        d12, _ = ted_similarity(t1, t2)
        d21, _ = ted_similarity(t2, t1)
        assert abs(d12 - d21) < 1e-9

    def test_dissimilar_countries_below_threshold(self):
        """China vs Liechtenstein should be clearly less similar than Germany-France."""
        t1 = build_country_tree(_load("china"))
        t2 = build_country_tree(_load("liechtenstein"))
        _, sim = ted_similarity(t1, t2)
        assert sim < 0.70, f"Expected sim < 0.70, got {sim:.3f}"

    def test_very_similar_countries_above_threshold(self):
        """Germany vs France should be quite similar."""
        t1 = build_country_tree(_load("germany"))
        t2 = build_country_tree(_load("france"))
        _, sim = ted_similarity(t1, t2)
        assert sim > 0.60, f"Expected sim > 0.60, got {sim:.3f}"

    def test_similar_countries_more_similar_than_dissimilar(self):
        """Germany-France similarity should exceed China-Liechtenstein similarity."""
        t_de = build_country_tree(_load("germany"))
        t_fr = build_country_tree(_load("france"))
        t_cn = build_country_tree(_load("china"))
        t_li = build_country_tree(_load("liechtenstein"))
        _, sim_similar = ted_similarity(t_de, t_fr)
        _, sim_dissimilar = ted_similarity(t_cn, t_li)
        assert sim_similar > sim_dissimilar, (
            f"Germany-France ({sim_similar:.3f}) should exceed "
            f"China-Liechtenstein ({sim_dissimilar:.3f})"
        )