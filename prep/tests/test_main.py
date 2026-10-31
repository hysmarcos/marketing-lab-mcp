from prep.__main__ import commands, main


def test_unknown_name_prints_usage_and_exits_2(capsys):
    assert main(["prep", "nope"]) == 2
    err = capsys.readouterr().err
    assert "unknown name: nope" in err
    assert "usage: python -m prep" in err


def test_no_name_prints_usage_and_exits_2(capsys):
    assert main(["prep"]) == 2
    assert "usage: python -m prep" in capsys.readouterr().err


def test_commands_list_the_prep_modules_and_not_the_library():
    assert commands() == ["funnel", "hillstrom", "journeys", "olist", "reference"]
