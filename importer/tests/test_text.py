import pytest
from importer.text import normalise_name, is_likely_not_public, clean_website

@pytest.mark.parametrize("raw, expected", [
    ("Association Le Club de Go d'Évry !", "go evry"),
    ("CLUB D'ÉCHECS DE LYON", "echecs lyon"),
    ("  Amicale  des   Boulistes ", "boulistes"),
])
def test_normalise_name_matches_sql_rule(raw, expected):
    assert normalise_name(raw) == expected

@pytest.mark.parametrize("name, purpose, expected", [
    ("Syndicat de copropriété Les Tilleuls", None, True),
    ("Amicale du personnel de la mairie", "loisirs des agents", True),
    ("Club de Go de Lyon", "pratique du jeu de go", False),
])
def test_is_likely_not_public(name, purpose, expected):
    assert is_likely_not_public(name, purpose) is expected

@pytest.mark.parametrize("raw, expected", [
    ("www.clubgo-lyon.fr", "https://www.clubgo-lyon.fr"),
    ("http://exemple.org/", "http://exemple.org/"),
    ("contact@exemple.org", None), ("", None), ("néant", None), (None, None),
])
def test_clean_website(raw, expected):
    assert clean_website(raw) == expected
