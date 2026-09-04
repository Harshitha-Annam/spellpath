"""Riddle-style clues for target words (shown in live duels instead of the word)."""

from __future__ import annotations

from typing import Dict

# Keep clues short — they sit in a compact card above the board.
WORD_CLUES: Dict[str, str] = {
    # 3
    "CAT": "A soft-footed house hunter that loves naps and yarn",
    "DOG": "A loyal friend who greets you at the door with a wag",
    "ZIP": "A fast close that runs along teeth of metal or plastic",
    "MAP": "Paper or screen that helps you find where to go",
    "SUN": "The bright star that warms the day and lights the sky",
    "RUN": "What you do when your feet move faster than a walk",
    "FOX": "A clever wild creature known for its bushy red tail",
    "BOX": "A cube you pack things into for storage or shipping",
    "KEY": "A small tool that unlocks doors, secrets, or codes",
    "TOY": "Something made for play, not for serious work",
    # 4
    "WORD": "A unit of language made of letters with meaning",
    "GAME": "A contest or pastime played for fun or victory",
    "MAZE": "A winding puzzle of paths meant to confuse you",
    "PATH": "The route you follow from one place to another",
    "GOLD": "A precious yellow metal prized for wealth and shine",
    "STAR": "A distant light that twinkles in the night sky",
    "BLUE": "The color of a clear daytime sky or deep ocean",
    "FIRE": "I'm often the reason people gather close together on a cold night",
    "WIND": "Invisible air that moves and can make trees sway",
    "LAND": "Solid ground, not sea — a place you can stand on",
    # 5
    "BOARD": "A flat surface for games, notes, or building plans",
    "LIGHT": "What turns darkness away so you can see clearly",
    "WATER": "The clear liquid life drinks and rivers carry",
    "EARTH": "The planet we live on, or the soil beneath our feet",
    "TRAIL": "A marked route through woods that hikers follow",
    "SHARK": "A fierce ocean hunter with a famous fin",
    "CROWN": "A jeweled circle worn by royalty on the head",
    "CLOCK": "A face with hands that quietly counts the hours",
    "STONE": "Hard rock shaped by time, heavier than it looks",
    "SPACE": "The endless dark beyond the sky where planets drift",
    # 6
    "PUZZLE": "A challenge of pieces or clues waiting to be solved",
    "MATRIX": "A grid of numbers, or a world of digital patterns",
    "FOREST": "A thick gathering of trees where sunlight filters through",
    "CASTLE": "A fortified home of towers, walls, and kings",
    "SHADOW": "The dark shape that follows you when light is behind",
    "BRIDGE": "A structure that lets you cross what divides two sides",
    "STREAM": "A small river that chatters over rocks as it flows",
    "KNIGHT": "An armored warrior sworn to honor and protection",
    "WIZARD": "A mage who bends magic with staff and spell",
    "DRAGON": "A legendary winged beast that breathes flame",
    # 7
    "JOURNEY": "A long trip of many steps toward a distant goal",
    "MYSTERY": "A secret waiting to be uncovered by clues",
    "PHANTOM": "A ghostly presence felt more than clearly seen",
    "THUNDER": "The booming sound that follows a flash of lightning",
    "CRYSTAL": "A clear gem that catches light and sparkles",
    "COMPASS": "A needle that always points you toward north",
    "MONSTER": "A fearsome creature from stories and nightmares",
    "LANTERN": "A portable glow that guides you through the dark",
    "VICTORY": "The sweet moment when the contest is finally won",
    "HARVEST": "The season when crops are gathered from the fields",
    # 8
    "MOUNTAIN": "A giant of stone that scrapes against the clouds",
    "TREASURE": "Hidden riches waiting for a lucky finder",
    "VOLCANO": "A mountain that can wake and spit fire and ash",
    "FRONTIER": "The wild edge of known lands and new beginnings",
    "PYRAMID": "An ancient triangle of stone rising from the desert",
    "UNIVERSE": "Everything that exists — stars, worlds, and space between",
    "FORTRESS": "A stronghold built to keep enemies outside the walls",
    "SPARKLE": "A quick glitter of light dancing on a surface",
    "WINDMILL": "Tall arms that turn when the breeze pushes them",
    "CAROUSEL": "A circling ride of painted horses and music",
    # 9
    "ADVENTURE": "An exciting quest full of risk and discovery",
    "LIGHTNING": "A sudden white bolt that splits the stormy sky",
    "WONDERLAND": "A magical place where ordinary rules melt away",
    "LABYRINTH": "A complex maze designed to trap the wanderer",
    "STARLIGHT": "Soft glow that falls from distant suns at night",
    "MOONLIGHT": "Pale silver light poured by the night's companion",
    "FIRELIGHT": "Warm flicker that paints faces around a campfire",
    "WHIRLPOOL": "Water spinning into a dangerous circling pull",
    "DAYBREAK": "The first pale light when night finally ends",
    "NIGHTFALL": "The quiet hour when daylight fades into dark",
    # 10
    "SPELLBOUND": "Held still by wonder, as if under a charm",
    "STORMCLOUD": "A dark sky mass heavy with rain and thunder",
    "MASTERMIND": "The clever planner behind a grand scheme",
    "CROSSROADS": "A place where paths meet and choices must be made",
    "AFTERGLOW": "The soft color left in the sky after sunset",
    "PATHFINDER": "One who discovers the way through unknown ground",
    "BRIGHTNESS": "The quality of shining strongly with light",
    "SNOWFLAKE": "A unique crystal of ice that drifts from winter skies",
    "WATERFALL": "A river that leaps over a cliff in roaring spray",
    "CANDLELIGHT": "A gentle flame that softens a room after dark",
}


def clue_for_word(word: str) -> str:
    cleaned = (word or "").strip().upper()
    if not cleaned:
        return "Connect the letters in order to reveal the hidden answer"
    return WORD_CLUES.get(
        cleaned,
        f"Connect the letters to spell a {len(cleaned)}-letter answer",
    )
