/**
 * Slug vocabulary (see GLOSSARY.md): the Slug is a Pad's only public
 * identifier. Generation picks two words from the bundled word list — a
 * deliberate memorability-over-obscurity trade-off (spec: ~10^6
 * combinations for Plain Pads, mitigated by always-on rate limiting).
 *
 * Reserved route names can never become Slugs: they would shadow real
 * routes or the Default Pad.
 */

/** Words a generated Slug draws from (lowercase a–z only). */
export const WORDS: readonly string[] =
  `able acid acre aged also area army away baby back ball band bank base bath bean bear beat been beef bell belt bend best bike bill bird bite blow blue boat body bold bone book boot born both bowl bulk burn bush busy cage cake call calm came camp card care case cash cast cave cell chat chef chip city clay clip club coal coat code coin cold come cook cool cope copy core corn cost crew crop dark data date dawn days dead deal dear debt deep deny desk dial diet disc does done door dose down draw drew drop drum dual duck dust duty each earn ease east easy edge edit else ends even ever exit face fact fail fair fall farm fast fate fear feed feel feet fell felt file fill film find fine fire firm fish fist five flat flaw flee flew flip flow foam fold folk font food foot fork form fort foul four free from fuel full fund gain game gate gave gear gene gift girl give glad glow goal goes gone gray grew grey grim grin grip grow gulf hair half hall hand hang hard harm hate have head hear heat held hell help herb here hero hers hide high hill hint hire hold hole holy home hope horn host hour huge hung hunt hurt icon idea inch into iron item join jump jury just keen keep kept keys kick kind king kiss knee knew know lack lady laid lake lamp land lane last late lava lawn lazy lead leaf lean leap left lend lens less life lift like lily limb lime line link lion list live load loan lock loft logo long look lord lose loss lost loud love luck lung made mail main make male mall many maple march mark mass mast mate math meal mean meat meet melt memo mend menu mere mesh mild mile milk mind mine mint miss mist mode mold mole monk mood moon more most moth move much mule must myth nail name navy near neat neck need neon news next nice nine node none noon norm nose note noun oath odds okay once only onto open oral oven over pace pack page paid pain pair pale palm park part pass past path peak pear peel peer pelt pest pick pile pill pine pink pint pipe plan play plea plot plug plum plus poem poet pole poll pond pool poor pore port pose post pour pray prey pull pump pure push quad quit quiz race raft rage rain rank rare rate read real reef rely rent rest rice rich ride ring riot rise risk road roar robe rock role roll roof room root rope rose ruby rude ruin rule rush rust safe sage sail sale salt same sand save scan seal seam seat seed seek seem seen self sell send sent shed ship shoe shop shot show shut side sigh sign silk sing sink site size skin skip slab slam slap sled slid slim slip slot slow snap snow soak soap soar sock sofa soft soil sold sole solo some song soon sore sort soul soup sour span spar spec spin spot spun spur stag star stay stem step stew stir stop stow stub stud such suit sung sunk sure surf swap swim tail take tale talk tall tank tape task taxi team tear tech tell tend tent term test text than that thaw thee them then they thin this thou thud thug thus tick tide tidy tile till tilt time tiny tips tire toad toll tomb tone tons took tool torn toss tour town toys trap tray tree trim trip true tube tuna tune turf turn twin type ugly undo unit upon urge used user vain vary vast veil vein verb very view vine visa void volt vote wade wage wait wake walk wall wand want ward warm wash wasp wave weak wear weed week weep well went were west what when whip whom wide wife wild will wind wine wing wipe wire wise wish with wolf wood wool word wore work worm wrap yard yarn yawn year yell your zeal zero zone zoom acorn agent album alert alien alley almond alpha amber anchor angle ankle apple apron arcade arch arctic argue armor arrow aspen asset atlas atom attic audio autumn axiom bacon badge bagel bakery bamboo banana banjo barge basil basin batch beach beacon beagle beam beard beast beech beetle beret berry bishop bison blanket blaze blend blimp blink block bloom bluff blush board boast bolt bonus booth bounce boulder branch brave breeze brick bridge bright brisk broad broken brook brush bubble bucket buffalo bugle bulb bunny burrow butter button cabin cable cactus camel canal candle canoe canvas canyon carbon cargo carpet carrot castle cedar cello cement census chalk charm chart cheese cherry chess chest chili chimney choir chorus cider circle citrus civil clamp clever cliff cloak clock cloud clover coach coast cobra cocoa collar colony color comet comic coral cotton couch cougar county couple cover coyote crab crane crater crayon cream creek crest cricket crown crumb crust crystal cupid curly current curve cycle cymbal daisy decoy delta demon denim depth desert detour device diary diesel dime ditch diver dock dodge domino donkey donut dough dove dragon drama drift duet dusk eagle earth easel echo eclipse egret elbow elder ember emerald empty engine envoy epic era error essay ether ethic event evoke exact exile extra fable fabric falcon fancy feast fence fern ferry fever fiber fiddle fig filter finch fjord flag flame flannel flare flask fleet flint float flock flora floss flute fossil fragile frame freckle frost fudge fungus funnel gadget galaxy gallon garden garlic gauge gazelle gecko ghost giant ginger giraffe glacier glade glass glide gloss glove glue goblet golden gopher gorge gourd grace grain granite grape gravel gravy graze green greet grid grill groan groom groove grove growl guava guide guitar gully gumbo gusto gutter habit halo hamlet hammer hamster handle harbor harvest hatch haven hazel heap heart hedge helmet herald heron hickory hollow honey horizon hornet hostel huddle human humid hunter hurdle husk igloo impala inbox index indigo ingot inlet iris island ivory jacket jade jaguar jasmine jelly jersey jewel jigsaw jockey jolly joust judge juice jumbo junction juniper kayak kelp kennel kernel kettle kiln kiosk kitten kiwi knapsack knight knot koala label ladder lagoon lantern lapel larch lasso latch laurel layer ledge legacy lemon lentil leopard lever liberty lichen lilac lizard llama lobby lobster locket lodge log lotus lounge lucid luggage lumber lunar lunch lyric macaw magnet magnolia maize mango manor marble marina market marsh mascot mason meadow melon mentor mercy mesa metal meteor mill mimic mineral mirror mitten mocha module molten moment monkey moose morning mosaic moss motel mother motor mouse muffin mulberry mural muscle museum mushroom mustard nacho napkin narrow nation nature nebula nectar needle nephew nickel nimble noble nomad noodle north notch nougat novel nozzle nudge nugget nutmeg nylon oasis oat ocean octave odor olive omega onion onyx opal opera orange orbit orchard organ osprey otter outfit oval oxen oyster ozone pancake panda pantry papaya papyrus parade parcel parsley pasta pastel patch patio pause peach peanut pearl pebble pedal pelican pencil penguin pepper perch petal phoenix photo piano pigeon pilot pistol pitch pixel pizza placid plank plant plasma plaza pledge pocket polar pollen pomelo poncho pony poplar poppy porch portal potato pouch powder prairie prawn pretzel prism prize prompt prose proton prune pulley pulse puma pumpkin punch pupil puppet purple puzzle python quail quarry quasar quench quill quilt quirk quiver radar radish rafter rainbow raisin rally ranch rascal raven ravine razor reason recipe reel refuge remedy reptile rescue resin retro rhino ribbon ridge rifle rigid rink ripple ritual river roast robin robot rocket rodeo roller rooster rotary rotor royal rubber rugby rumba rumor runner rustic saddle saffron sailor salmon salon salsa sapphire sardine satchel satire sauce sauna savory scallop scarlet scenic school scoop scooter scout scrap scrub scuba sedan sepal sequel sequoia serif shade shadow shale shark shawl shelf sheriff shore shrimp shuttle sienna sierra signal silo silver sinus siren skillet skunk skyline slalom slate sleigh slick slope smoke smudge snail snake sneaker sniper skunk social socket soda solar solstice sonar sonnet sorbet sound spark sparrow spatula spear spice spider spinach spiral splash spoke sponge spoon spruce squash squirrel stable stadium staff stage stanza starch statue steady steam steel stellar stencil stone storm stove strand straw stream street stucco studio stump sugar summit sundae sunrise sunset swallow swamp swan sweater swing swoop syrup table tackle tadpole talon tango tavern tundra tunnel tusk tutor tweed twig twilight ultra umber umpire unicorn unison upland urban urchin utensil valley valve vanilla vapor vault velvet vendor verse vessel veteran vibrant video village vinegar violet violin vista vital vivid vocal volcano vowel voyage wafer wagon walnut walrus warden watt weave wedge weird whale wharf wheat wheel whisk whistle wicker widow willow window winter wisdom wizard wombat wonder world wreath wren wrench wrist yacht yeast yodel yogurt yonder yucca zebra zenith zephyr zinc zipper zodiac`
    .split(/\s+/)
    .filter((word) => word.length > 0)
    // Set-deduped so a stray repeated entry in the list cannot skew the odds.
    .filter((word, index, all) => all.indexOf(word) === index);

export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["api", "sync", "js", "default", "favicon.ico"]);

/** The longest Slug a custom override may have. */
export const MAX_SLUG_LENGTH = 63;

export class InvalidSlugError extends Error {}
export class ReservedSlugError extends Error {}
export class SlugTakenError extends Error {}

/** A Slug is a lowercase address segment: letters/digits, hyphens inside. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlugFormat(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

/**
 * Checks a custom Slug override; throws with a clear, user-facing message
 * when it cannot be used.
 */
export function validateCustomSlug(slug: string): void {
  if (slug.length === 0) {
    throw new InvalidSlugError("A custom Slug must not be empty — leave it out to get a generated one");
  }
  if (!isValidSlugFormat(slug)) {
    throw new InvalidSlugError(
      `"${slug}" is not a valid Slug: use lowercase letters, digits and hyphens (no leading, trailing or double hyphens), at most ${MAX_SLUG_LENGTH} characters`,
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ReservedSlugError(`"${slug}" is reserved for the site's own routes and cannot be used as a Slug`);
  }
}

/** Picks two different words from the bundled list, e.g. "amber-otter". */
export function generateSlug(): string {
  const first = WORDS[randomIndex(WORDS.length)];
  let second = WORDS[randomIndex(WORDS.length)];
  while (second === first) {
    second = WORDS[randomIndex(WORDS.length)];
  }
  return `${first}-${second}`;
}

function randomIndex(length: number): number {
  // Rejection sampling on crypto randomness: no modulo bias.
  const range = 0x1_0000_0000;
  const limit = range - (range % length);
  for (;;) {
    const value = globalThis.crypto.getRandomValues(new Uint32Array(1)).at(0);
    if (value !== undefined && value < limit) return value % length;
  }
}
