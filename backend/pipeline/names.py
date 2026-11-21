"""Synthetic name pools. Every person, company, site and domain here is
invented for the demo. Email domains use the reserved `.example` TLD
(RFC 2606) so no generated address can belong to a real organisation.
Nothing in this file is derived from PMO 360 production data.
"""

CLIENTS = [
    "Amberline Renewables", "Bluegill Energy Partners", "Cardinal Flats Power",
    "Driftwood Solar Holdings", "Elkhorn Clean Energy", "Fernbrook Power Co.",
    "Granite Run Energy", "Harrow Creek Renewables", "Ironleaf Energy",
    "Juniper Basin Power", "Kettle River Solar", "Larkspur Energy Group",
    "Meadowlark Power Partners", "Nettle Grove Renewables", "Oakvale Energy",
    "Pinecrest Grid Development", "Quarry Hill Power", "Redfern Solar",
    "Sablewood Energy", "Tamarack Flats Renewables", "Umber Ridge Power",
    "Vireo Energy Partners", "Willowmere Solar", "Yarrow Energy",
    "Zephyr Plains Power",
]

# Place-name parts for portfolios and sites.
PLACE_A = [
    "Cedar", "Silver", "Prairie", "Kestrel", "Owl", "Granite", "Copper", "Bramble",
    "Thistle", "Heron", "Falcon", "Maple", "Sandhill", "Bison", "Coyote", "Lark",
    "Aspen", "Juniper", "Sage", "Willow", "Hawk", "Fox", "Elm", "Birch", "Pine",
    "Quail", "Raven", "Clover", "Sorrel", "Tumble", "Wren", "Badger", "Cobble",
    "Dune", "Ember", "Flint", "Gable", "Holly", "Indigo", "Larch", "Mesa", "Nimbus",
]
PLACE_B = [
    "Hollow", "Flats", "Ridge", "Creek", "Bend", "Run", "Point", "Meadow",
    "Valley", "Springs", "Crossing", "Mesa", "Prairie", "Grove", "Field", "Bluff",
    "Lake", "Fork", "Hill", "Plains", "Basin", "Gap", "Draw", "Knoll",
]

STATES = [
    "TX", "AZ", "NV", "NM", "CO", "UT", "ID", "OR", "IL", "IN", "OH", "MI", "MN",
    "WI", "IA", "NE", "KS", "OK", "AR", "MO", "TN", "KY", "VA", "NC", "SC", "GA",
    "FL", "AL", "MS", "LA", "NY", "PA", "NJ", "MD",
]

TOWNS = [
    "Millbrook", "Harlan", "Carver", "Dunmore", "Elsworth", "Fairhope", "Glenrock",
    "Hadley", "Ingram", "Jasper", "Kinsley", "Lockport", "Marlow", "Newbury",
    "Oxbow", "Pella", "Quinlan", "Rushford", "Salem", "Tilden", "Ulysses",
    "Vernon", "Waverly", "Yates", "Zenda", "Ashby", "Belmont", "Clyde", "Dorset",
]

FIRST_NAMES = [
    "Avery", "Jordan", "Priya", "Marcus", "Elena", "Tomas", "Nadia", "Owen",
    "Leah", "Rafael", "Simone", "Dev", "Hannah", "Isaac", "Mei", "Caleb",
    "Ingrid", "Kofi", "Lucia", "Mateo", "Noor", "Oliver", "Paige", "Quentin",
    "Rosa", "Samir", "Tessa", "Uma", "Victor", "Wendy", "Xavier", "Yara",
    "Zane", "Amara", "Bennett", "Chloe", "Dmitri", "Esther", "Felix", "Gemma",
    "Hector", "Ivy", "Jonah", "Keira", "Liam", "Maya", "Nikhil", "Opal",
    "Pavel", "Quinn", "Ruth", "Soren", "Talia", "Ulrich", "Vera", "Wes",
    "Ximena", "Yusuf", "Zoe", "Anders", "Bianca", "Cyrus", "Daria", "Emeka",
    "Fiona", "Gideon", "Hiro", "Imani", "Jules", "Kenji", "Lorna", "Milo",
    "Nell", "Orrin", "Petra", "Rhea", "Stellan", "Thea", "Valentin", "Wynn",
]
LAST_NAMES = [
    "Raman", "Ojo", "Ruiz", "Halvorsen", "Achebe", "Lindqvist", "Moreau", "Tanaka",
    "Okafor", "Brennan", "Castell", "Delacroix", "Eriksen", "Farouk", "Galvez",
    "Hartley", "Iverson", "Jaramillo", "Kowalczyk", "Lachance", "Mbeki", "Nakamura",
    "Oyelaran", "Petrov", "Quintero", "Rasmussen", "Sorensen", "Thibault",
    "Underwood", "Varga", "Whitlock", "Xu", "Yilmaz", "Zielinski", "Abernathy",
    "Bancroft", "Cordero", "Dunleavy", "Esposito", "Fairweather", "Grimaldi",
    "Holloway", "Ishikawa", "Jovanovic", "Kincaid", "Lemaire", "Mancini",
    "Novak", "Ortega", "Pemberton", "Quayle", "Rourke", "Sandoval", "Trevino",
    "Ueda", "Vasquez-Lowe", "Wakefield", "Yoon", "Zamora", "Ashdown", "Bellamy",
]

INTERNAL_DOMAIN = "pmo360-demo.example"

BLOCKED_REASONS = {
    "Civil": [
        "Awaiting updated topographic survey from client",
        "Stormwater permit comments pending (county review)",
        "Geotechnical report outstanding from client",
    ],
    "Structural": [
        "Awaiting client geotechnical report (pile load tests)",
        "Racking vendor design loads not received",
        "Snow / wind load criteria not confirmed by client",
    ],
    "Electrical": [
        "Inverter vendor drawings outstanding",
        "Utility interconnection data pending",
        "Collector routing awaiting land-rights confirmation",
        "Transformer vendor data not received",
        "Module selection not final (string sizing on hold)",
        "Medium-voltage cable vendor data outstanding",
    ],
}

ACTION_TEMPLATES = [
    "Confirm {disc} design basis for {site}",
    "Send updated {disc} {stage} comments log to client",
    "Provide vendor data sheets needed for {disc} {stage}",
    "Review client markups on {stage} {disc} set",
    "Schedule {disc} coordination call with EPC",
    "Update {disc} schedule after client comments",
    "Resolve open RFI on {disc} scope at {site}",
    "Confirm interconnection requirements for {site}",
    "Issue revised {disc} calculation package",
    "Close out QC comments on {disc} {stage} drawings",
    "Obtain geotechnical data for {site}",
    "Confirm equipment selections affecting {disc} {stage}",
]

CO_TITLES = [
    "Additional pile layout iteration", "Revised collector system routing",
    "Re-layout for a new module size", "Revised AC collection layout for utility comments",
    "Extra stormwater analysis for county", "Change of inverter vendor",
    "Expanded arc-flash study", "Additional site access road design",
    "Revised fence / security layout", "Added SCADA integration scope",
]
