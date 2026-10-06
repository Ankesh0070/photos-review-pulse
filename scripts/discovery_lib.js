/* Discovery engine — coding rules (lexicons) for retrieval problems in real user text.
 * Pure functions, shared by the build script and the sampling/validation script.
 *
 * A review is "retrieval-relevant" only if it is about FINDING CONTENT (photos/videos/albums…), not about finding a
 * UI button. Inside relevant reviews we code, multi-label:
 *   PROBLEMS   what goes wrong when retrieving          CONTENT   what kind of thing they're trying to retrieve
 *   CLUES      what they search/filter by (= remember)   FORGOT    what they say they can't remember
 *   BEHAVIOUR  reformulation / giving up / scrolling     WORKAROUNDS  what they do instead
 */
const NORM = s => String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ');
const rx = (src, flags = 'i') => new RegExp(src, flags);
const W = (s) => '\\b(?:' + s + ')\\b';

/* ---------- gate ---------- */
const PHOTO_NOUN = rx(W("photos?|pictures?|pics?|images?|videos?|screenshots?|screen ?shots?|albums?|memories|library|gallery|camera roll|selfies?|clips?|recordings?"));
const R_VERB = rx(W("search(?:es|ed|ing)?|find(?:ing)?|found|locat(?:e|es|ed|ing)|looking for|look for|look(?:ed)? up|retriev\\w+|recover\\w*|scroll(?:ing|ed)?|browse|browsing|timeline|sort(?:ed|ing)?|filter(?:s|ed|ing)?|tag(?:s|ged|ging)?|label(?:s|led|ing)?|organi[sz]\\w+|disappear\\w*|vanish\\w*|missing|can'?t see|cannot see|not (?:showing|appearing|visible)|show(?:s|ing)? up|where (?:is|are|did|do|have|has|can)|gone|lost|jump to|go back|scrub\\w*"));
const UI_SEEK = rx("\\b(?:find|locate|see|get to|access|reach)\\b[^.!?]{0,25}\\b(?:the |an? |this |that |any )?(?:option|button|setting|settings|tool|tools|menu|feature|icon|toggle|link|tab|page|stabili[sz]er|editor|editing|way to|how to|where to|filter option|download|upgrade|subscription|plan|support|contact|help)\\b");
const CONTENT_NEAR = rx("\\b(?:search(?:es|ed|ing)?|find(?:ing)?|found|locat(?:e|ed|ing)|looking for|look for|scroll(?:ing)?|browse|retriev\\w+|recover\\w*)\\b[^.!?]{0,45}\\b(?:photos?|pictures?|pics?|images?|videos?|screenshots?|albums?|memories|clips?|selfies?|files?)\\b|\\b(?:photos?|pictures?|pics?|images?|videos?|screenshots?|albums?|memories|clips?)\\b[^.!?]{0,45}\\b(?:search(?:es|ed|ing)?|find|found|locat\\w+|scroll(?:ing)?|disappear\\w*|vanish\\w*|missing|gone|lost|not (?:showing|appearing|visible|there)|can'?t (?:see|find)|cannot (?:see|find))\\b|\\b(?:disappear\\w*|vanish\\w*|missing|gone|lost)\\b[^.!?]{0,30}\\b(?:photos?|pictures?|images?|videos?|albums?|memories)\\b|\\bsearch(?:es|ing)? (?:is|was|doesn'?t|does not|isn'?t|never|barely|can'?t|results?|function|feature|bar|engine|keywords?)\\b");
const STRUGGLE = rx("\\b(?:can'?t|cannot|couldn'?t|unable|hard|difficult|impossible|struggl\\w*|frustrat\\w*|annoy\\w*|no way|doesn'?t|does not|didn'?t|won'?t|isn'?t|aren'?t|not (?:working|showing|finding|able|possible|there|appearing|visible|loading)|useless|terrible|awful|worse|worst|poor|bad|broken|missing|lost|gone|disappear\\w*|vanish\\w*|wish|should|no results|nothing|waste|stuck|issue|problem|bug|fail\\w*|ruin\\w*|hate|horrible|garbage|junk|pathetic|unusable|never)\\b");
const SUCCESS = rx("\\b(?:easy|easily|quick(?:ly)?|fast|love|great|amazing|awesome|perfect|works? (?:great|well|perfectly)|so (?:easy|good|helpful)|helpful|magic(?:al)?|impressive|accurate|smart|brilliant|best|excellent|handy|convenient|finds? (?:any|anything|exactly|what))\\b");
const BOILER = [/easily store, edit, organi[sz]e, and search your memories[^.]*\./ig, /google photos is the home for all your photos and videos\.?/ig, /organi[sz]e your photos\.?/ig];
function isRetrieval(t) {
  if (!PHOTO_NOUN.test(t) || !R_VERB.test(t)) return false;
  if (!CONTENT_NEAR.test(t)) return false;
  if (!STRUGGLE.test(t) && !SUCCESS.test(t)) return false;
  // "can't find the stabilizer option" = feature discoverability, not content retrieval — unless content retrieval is also stated
  if (UI_SEEK.test(t) && !/\b(?:my|the|those|these|old|some|all)\s+(?:\w+\s+)?(?:photos?|pictures?|videos?|images?|albums?)\b[^.!?]{0,40}\b(?:can'?t|cannot|missing|disappear\w*|gone|lost|not (?:showing|appearing))/.test(t) && !/\bsearch\b/.test(t)) return false;
  return true;
}
const isUiSeek = t => UI_SEEK.test(t);
/* strip scraper prefixes / store boilerplate and decode entities so only the user's own words are coded */
function clean(raw) {
  let s = String(raw || '').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ');
  s = s.replace(/^\s*Review on Google Play Store(?: \(Main App\))?\.\s*/i, '').replace(/^\s*Comment on video [\w-]+\.?\s*/i, '').replace(/^\s*HN discussion on Google Photos \([^)]*\)\.\s*/i, '');
  BOILER.forEach(b => { s = s.replace(b, ' '); });
  return s.replace(/\s+/g, ' ').trim();
}
function valence(t, rating) {
  const s = STRUGGLE.test(t), g = SUCCESS.test(t);
  if (rating != null) { if (rating <= 2) return 's'; if (rating >= 4 && !s) return 'g'; if (rating >= 4 && s && g) return 'm'; }
  return s && g ? 'm' : s ? 's' : g ? 'g' : 'n';
}

/* ---------- retrieval problems ---------- */
const PROBLEMS = [
  { id: 'search_quality', label: 'Search returns nothing / the wrong thing', short: 'Search quality',
    re: [rx("\\b(?:search|searching|searches)\\b[^.!?]{0,60}\\b(?:useless|terrible|awful|broken|doesn'?t work|does not work|not working|never works?|worthless|garbage|horrible|poor|bad|slow|inaccurate|unreliable|joke|worse|no results|nothing|wrong|irrelevant|random|unrelated|fails?|failed|can'?t find|cannot find|doesn'?t find|doesn'?t show|won'?t find|doesn'?t understand|limited|weak)"), rx("\\bno results\\b|\\bnothing (?:comes up|shows up|found|appears)\\b|\\bcan'?t search\\b|\\bcannot search\\b|\\bwrong results\\b|\\bsearch (?:results?|function|feature|bar|engine|suggestions?|keywords?)\\b[^.!?]{0,40}\\b(?:bad|poor|wrong|useless|broken|missing|removed|gone|worse|terrible|doesn'?t|isn'?t)")] },
  { id: 'missing_photos', label: 'Photos vanish / are not showing', short: 'Missing / vanished',
    re: [rx("\\b(?:my|our|all|some|many|most|half(?: of)?|few|several|lots? of|the|those|these|old|entire|whole|new)\\s+(?:\\w+\\s+){0,2}(?:photos?|pictures?|videos?|images?|albums?|memories)\\b[^.!?]{0,40}\\b(?:disappear\\w*|vanish\\w*|(?:went|gone|is|are|were|was|been|got|keep|keeps) missing|gone|lost|deleted (?:themselves|on their own|automatically|by itself)|not (?:showing|appearing|visible|there|synced|loading|available|found)|can'?t (?:see|find|access|view|locate)|cannot (?:see|find|access|view|locate)|no longer (?:show|appear|there|available|visible)|aren'?t (?:showing|there|visible|appearing)|don'?t (?:show|appear)|doesn'?t (?:show|appear)|missing from)"),
         rx("\\b(?:disappear\\w*|vanish\\w*|lost|went missing|are missing|is missing|got deleted|deleted)\\b[^.!?]{0,25}\\b(?:my|all|some|many|most|half(?: of)?|the|years of)\\s+(?:\\w+\\s+){0,2}(?:photos?|pictures?|videos?|images?|albums?|memories)")] },
  { id: 'dates_order', label: 'Wrong dates / photos out of order', short: 'Dates & ordering',
    re: [rx("\\b(?:wrong|incorrect|different|changed?|mixed up|jumbled|messed up|random|shuffled?|scrambled|out of order|not in order|reversed)\\b[^.!?]{0,25}\\b(?:dates?|order|timeline|chronolog\\w*|time ?stamps?)\\b"),
         rx("\\b(?:dates?|timeline|chronolog\\w*|order)\\b[^.!?]{0,30}\\b(?:is|are|was|were|got|gets)? ?(?:wrong|incorrect|messed|mixed|jumbled|random|broken|changed|not (?:right|correct|accurate|in order)|out of order)"),
         rx("\\b(?:photos?|pictures?|videos?)\\b[^.!?]{0,30}\\b(?:out of order|not in (?:chronological )?order|in the wrong (?:order|place|date)|wrong date|show(?:s|ing)? (?:the )?wrong date|random(?:ly)? (?:order|placed|sorted))"),
         rx("\\bchronological\\b|\\bsort(?:ed)? by (?:date|upload|date taken)\\b|\\bdate taken\\b|\\bupload(?:ed)? date\\b")] },
  { id: 'people_faces', label: 'People / face grouping fails', short: 'People & faces',
    re: [rx("\\b(?:face|faces|facial|face group\\w*|face recogni\\w*|people (?:album|section|tab|label\\w*)|face labels?)\\b[^.!?]{0,50}\\b(?:wrong|incorrect|mix\\w*|missing|can'?t|cannot|doesn'?t|not|merge|duplicate|disappear\\w*|gone|removed|stuck|fail\\w*|inaccurate|broken)"), rx("\\b(?:face|facial) (?:grouping|group|recognition|detection|matching)\\b")] },
  { id: 'location', label: 'Location / places don’t help', short: 'Location & places',
    re: [rx("\\b(?:location|locations|places|map|geotag\\w*|gps)\\b[^.!?]{0,50}\\b(?:wrong|missing|can'?t|cannot|doesn'?t|not|removed|no longer|gone|broken|fail\\w*|inaccurate|off)\\b"), rx("\\bsearch(?:ing)? (?:by|for|using) (?:location|place|places|map)\\b")] },
  { id: 'text_docs', label: 'Documents, screenshots & text in images', short: 'Docs / screenshots / text',
    re: [rx("\\b(?:screenshots?|screen ?shots?|documents?|receipts?|invoices?|ocr|handwrit\\w*|scanned|text (?:in|inside|within|from|on) (?:a |the |my )?(?:photos?|images?|pictures?|screenshots?)|search(?:ing)? (?:for )?text)\\b[^.!?]{0,60}\\b(?:search|find|found|locat\\w+|look(?:ing)? for|can'?t|cannot|recogni[sz]\\w*|read|ocr|index\\w*)"), rx("\\b(?:search|find|found)\\b[^.!?]{0,40}\\b(?:screenshots?|documents?|receipts?|text in)\\b")] },
  { id: 'organization', label: 'Albums / folders / organising are hard', short: 'Albums & organising',
    re: [rx("\\b(?:hard|difficult|impossible|confusing|annoying|no way|can'?t|cannot|unable|laborious|tedious|clunky|painful|nightmare|struggl\\w*)\\b[^.!?]{0,30}\\b(?:find|organi[sz]e|sort|manage|categori[sz]e|move|add|group|file|arrange)\\b[^.!?]{0,40}\\b(?:albums?|folders?|photos?|pictures?|collections?|videos?)\\b"),
         rx("\\b(?:albums?|folders?|organi[sz]ing|organi[sz]ation|collections?)\\b[^.!?]{0,45}\\b(?:hard|difficult|confusing|messy|laborious|tedious|clunky|impossible|buried|hidden|cluttered|can'?t find|cannot find|disorgani[sz]ed|a mess|nightmare)")] },
  { id: 'personal_tags', label: 'Can’t add own tags / notes / captions', short: 'No personal tags / notes',
    re: [rx("\\b(?:add|adding|want|wish|need|ability|option|feature|way|able|allow|let)\\b[^.!?]{0,30}\\b(?:tags?|tagging|labels?|labelling|labeling|captions?|notes?|descriptions?|keywords?|custom names?|rename)\\b[^.!?]{0,30}\\b(?:photos?|pictures?|images?|videos?|albums?|them|it|so)\\b"),
         rx("\\b(?:no|can'?t|cannot|without|missing)\\b[^.!?]{0,15}\\b(?:tags?|tagging|labels?|captions?|notes?|keywords?)\\b[^.!?]{0,30}\\b(?:photos?|pictures?|images?|search|find)\\b")] },
  { id: 'search_history', label: 'No search history / saved searches / refinement', short: 'No search history / refine',
    re: [rx("\\b(?:search history|recent searches?|saved searches?|previous searches?|last search|search suggestions?|refine (?:the )?search|narrow(?:ing)? (?:down )?(?:the )?(?:search|results)|search filters?|advanced search|filter (?:by|results|search))\\b")] },  { id: 'old_scale', label: 'Scrolling forever through a huge / old library', short: 'Scale & old photos',
    re: [rx("\\b(?:scroll(?:ing|ed)?|swipe|swiping|jump(?:ing)?|go(?:ing)? back|scrub\\w*)\\b[^.!?]{0,50}\\b(?:forever|endless\\w*|thousands|years|old(?:er|est)?|far back|way back|back in time|to (?:find|get to|reach)|date|year|month|beginning|bottom)"), rx("\\b(?:thousands|hundreds|too many|huge|large|massive) (?:of )?(?:photos|pictures|images|library|collection)\\b[^.!?]{0,60}\\b(?:find|search|scroll|locate|hard|impossible|difficult)"), rx("\\b(?:oldest|old(?:er)?) (?:photos?|pictures?|images?|videos?|memories)\\b[^.!?]{0,60}\\b(?:find|search|scroll|locate|hard|can'?t|cannot|impossible|missing|jump)")] },
  { id: 'deleted_trash', label: 'Deleted / archived items can’t be recovered or found', short: 'Deleted & archived',
    re: [rx("\\b(?:deleted|trash|bin|recycle|recover\\w*|restor\\w*|undelete|permanently|archive[ds]?)\\b[^.!?]{0,50}\\b(?:can'?t|cannot|where|find|how|lost|gone|accident\\w*|oops|mistake|disappear\\w*|not (?:in|showing|there)|empty|30 days|60 days)")] },
  { id: 'shared', label: 'Shared / partner photos can’t be found', short: 'Shared photos',
    re: [rx("\\b(?:shared|sharing|partner|share link|invite[ds]?|shared album)\\b[^.!?]{0,50}\\b(?:can'?t|cannot|find|see|missing|disappear\\w*|not (?:showing|visible|there|saved)|where)")] },
  { id: 'backup_state', label: 'Not backed up / sync gaps make photos unfindable', short: 'Backup gaps',
    re: [rx("\\b(?:back(?:ed)? ?up|sync(?:ed|ing)?|upload(?:ed|ing)?|cloud)\\b[^.!?]{0,60}\\b(?:stuck|fail\\w*|never|won'?t|doesn'?t|incomplete|pending|waiting|missing|half|some of|not (?:all|showing|there|syncing|uploaded))")], needs: 'retrievalSignal' },
  { id: 'ui_change', label: 'UI changes made things harder to find', short: 'UI changes',
    re: [rx("\\b(?:new|latest|recent|last) (?:update|version|design|redesign|ui|layout|interface)\\b[^.!?]{0,80}\\b(?:find|search|where|can'?t|cannot|moved|removed|hidden|buried|gone|confusing|harder|worse)"), rx("\\b(?:search bar|search button|tabs?|bottom (?:bar|nav)|library tab|menu)\\b[^.!?]{0,40}\\b(?:moved|removed|gone|hidden|missing|where|can'?t find|confusing)")] },
  { id: 'edited_copies', label: 'Edited versions / duplicates can’t be found', short: 'Edits & duplicates',
    re: [rx("\\b(?:edit(?:ed|s)?|copy|copies|duplicate[sd]?|original)\\b[^.!?]{0,50}\\b(?:can'?t find|cannot find|where|missing|disappear\\w*|not (?:showing|saved)|lost|gone)")] },
  { id: 'general_difficulty', label: 'Finding things is hard (not specified)', short: 'General difficulty', re: [] },
  { id: 'ai_expectation', label: 'Wants smarter / natural-language search', short: 'Wants AI search',
    re: [rx("\\b(?:ask photos|gemini|natural language|semantic|ai search|smart search|search (?:with|using|by) ai|conversational|magic search|search by (?:description|describing|content)|object recogni\\w*|image recogni\\w*|describe (?:what|the photo)|search (?:for|by) (?:objects?|things|content))\\b"), rx("\\bsearch\\b[^.!?]{0,40}\\b(?:smarter|smart|intelligent|ai|natural|understand(?:s|ing)? (?:what|me|natural)|by what'?s in)")] },
];

/* ---------- what they are trying to retrieve ---------- */
const OLD = rx(W("old(?:er|est)?|years? ago|from 20\\d\\d|from 19\\d\\d|back in 20\\d\\d|decades?|vintage|ancient|early photos|past photos|previous years|oldest|long ago|childhood"));
const CONTENT = [
  { id: 'family', label: 'Family & people moments (kids, parents, wedding, birthdays)', re: rx(W("family|kids?|child(?:ren)?|baby|babies|son|daughter|grand(?:kids?|children|ma|pa|mother|father)|wife|husband|parents?|mom|dad|mother|father|newborn|wedding|birthday|relatives?")) },
  { id: 'travel', label: 'Trips, events & holidays', re: rx(W("trip|trips|vacation|holiday|holidays|travel(?:l?ing)?|honeymoon|party|event|events|concert|graduation|festival|christmas|diwali|cruise")) },
  { id: 'documents', label: 'Documents, IDs, receipts & notes', re: rx(W("documents?|receipts?|invoices?|bills?|passport|id card|license|licence|prescription|certificate|tickets?|contract|forms?|pdf|handwritten|whiteboard")) },
  { id: 'screenshots', label: 'Screenshots & screen recordings', re: rx(W("screenshots?|screen ?shots?|screen recordings?")) },
  { id: 'videos', label: 'Videos & clips', re: rx(W("videos?|clips?|movies?|recordings?")) },
  { id: 'received', label: 'Photos received / saved from WhatsApp, social & downloads', re: rx(W("whatsapp|telegram|messenger|instagram|facebook|snapchat|downloaded?|received|forwarded|saved from|messages?")) },
  { id: 'old_device', label: 'Photos from an old phone / account / migration', re: rx(W("old (?:phone|device|account|iphone|android|computer|laptop)|previous (?:phone|device|account)|switch(?:ed|ing)? (?:phone|to)|new phone|transfer(?:red)?|migrat\\w+|restore[d]? (?:phone|backup)|takeout|icloud|dropbox")) },
  { id: 'scanned', label: 'Scanned / printed / film photos', re: rx(W("scanned|photo ?scan|printed photos?|film|negatives?|slides?")) },
  { id: 'pets_things', label: 'Pets, food, scenery & objects', re: rx(W("dog|cat|pet|puppy|kitten|food|car|flowers?|sunset|beach|mountains?|garden|animals?")) },
  { id: 'edited', label: 'Edited versions', re: rx(W("edited|my edits?|after editing|cropped|filtered")) },
];

/* ---------- what they search / filter BY  (=what they remember) ---------- */
const CLUE_LEAD = rx("\\b(?:search(?:es|ed|ing)?|filter(?:s|ed|ing)?|look(?:ed|ing)? (?:up|for)|typ(?:e|ed|ing)|sort(?:ed|ing)?)\\s+(?:for\\s+|by\\s+|using\\s+|with\\s+|via\\s+|on\\s+|through\\s+)?(?:the\\s+|a\\s+|an\\s+|my\\s+|their\\s+)?([a-z0-9' -]{2,38})", 'ig');
const CLUES = [
  { id: 'person', label: 'A person (name, face, relation)', re: rx(W("person|people|persons|face|faces|name|names|friend|wife|husband|mom|dad|mother|father|daughter|son|child|children|baby|relative|him|her|someone|girlfriend|boyfriend")) },
  { id: 'place', label: 'A place / location', re: rx(W("location|locations|place|places|city|country|town|map|gps|where|landmark|geotag\\w*|venue|restaurant|hotel")) },
  { id: 'date', label: 'A date / time period', re: rx(W("date|dates|year|years|month|months|day|days|when|time|timestamp|period|season|summer|winter|week|20\\d\\d|19\\d\\d")) },
  { id: 'event', label: 'An event / occasion', re: rx(W("event|events|wedding|birthday|trip|vacation|holiday|party|occasion|festival|graduation|christmas|diwali|concert")) },
  { id: 'object', label: 'An object / scene in the picture', re: rx(W("object|objects|thing|things|dog|cat|beach|food|car|sky|flower|flowers|sunset|animal|animals|scene|content|contents|mountain|tree|building|baby|sea|pet|pets|what'?s in")) },
  { id: 'text', label: 'Words / text / a caption', re: rx(W("text|word|words|number|numbers|caption|captions|description|descriptions|keyword|keywords|title|filename|file name|ocr|phrase|letters|handwriting")) },
  { id: 'kind', label: 'A type or source (screenshot, video, album…)', re: rx(W("screenshot|screenshots|video|videos|selfie|selfies|panorama|type|album|albums|folder|folders|favorites?|starred|raw|gif")) },
  { id: 'look', label: 'How it looked (colour, clothing)', re: rx(W("color|colour|colors|colours|wearing|dress|shirt|blue|red|green|pink|black|white|yellow|bright|dark")) },
];
/* explicit quoted queries:  searched "dog"  /  typed 'beach 2019' */
const QUOTED = rx("(?:search(?:ed|ing|es)?|typ(?:e|ed|ing)|look(?:ed|ing)? (?:up|for)|query|keyword|term)\\b[^\"“”.!?]{0,22}[\"“]([^\"”]{2,45})[\"”]", 'ig');
/* ---------- what they say they cannot remember ---------- */
const FORGOT_LEAD = rx("\\b(?:don'?t|do not|can'?t|cannot|couldn'?t|didn'?t|forgot|forget|no idea|hard to|never)\\b\\s+(?:really\\s+|exactly\\s+|always\\s+|even\\s+)?(?:remember|recall)\\b[^.!?]{0,40}|\\b(?:not sure|unsure|no idea|can'?t tell|don'?t know)\\s+(?:exactly\\s+)?(?:when|where|which|what)\\b[^.!?]{0,30}\\b(?:photo|picture|video|taken|saved|album|screenshot|it was|i took)\\b[^.!?]{0,20}|\\b(?:only|just|vaguely|barely)\\s+(?:remember|recall)\\b[^.!?]{0,40}|\\b(?:somewhere|sometime)\\b[^.!?]{0,6}\\b(?:in|around|from|between|during)\\b[^.!?]{0,14}\\b(?:20\\d\\d|19\\d\\d|summer|winter|spring|monsoon|last year|years? ago|months? ago)\\b", 'ig');const FORGOT_KIND = [['time', rx(W("when|date|year|month|day|time|exact|period|20\\d\\d|summer|winter|ago"))], ['name', rx(W("what|name|title|called|filename"))], ['who', rx(W("who|person|people"))], ['where', rx(W("where|which|album|folder|place|location"))]];

/* ---------- behaviour & workarounds ---------- */
const BEHAVIOUR = [
  { id: 'scroll_manual', label: 'Scrolls / goes through photos manually', re: rx("\\b(?:scroll(?:ed|ing)? (?:through|for|all|down|back|manually)|manual(?:ly)?|one by one|go(?:ing)? through (?:all|every|each|thousands)|dig(?:ging)? through|had to (?:scroll|go through|look through|search through))\\b") },
  { id: 'retry_terms', label: 'Retries with other words / several searches', re: rx("\\b(?:tr(?:y|ied|ying) (?:different|other|various|multiple|several|many) (?:words?|keywords?|terms?|searches|ways?|combinations?)|search(?:ed)? (?:several|multiple|many|a few) times|again and again|over and over|keep (?:searching|trying)|different (?:keywords?|words|terms))\\b") },
  { id: 'give_up', label: 'Gives up / wastes time', re: rx("\\b(?:gave up|give up|giving up|no luck|waste[sd]? (?:hours|time|so much time)|hours (?:of )?(?:searching|scrolling)|never (?:found|find) it|still can'?t find|couldn'?t find (?:it|them|anything)|impossible to find)\\b") },
  { id: 'by_luck', label: 'Finds it by accident', re: rx("\\b(?:by (?:chance|accident|luck)|happened to find|stumbled|accidentally found|randomly found|found (?:it|them) (?:by|after))\\b") },
];
const WORKAROUND = [
  { id: 'other_app', label: 'Uses another app (WhatsApp, Gallery, Dropbox, Drive…)', re: rx(W("dropbox|onedrive|icloud|google drive|files app|file manager|gallery app|samsung gallery|another app|other app|different app|third[- ]party|alternatives?|switch(?:ed|ing)? to|moved to|amazon photos|piwigo|immich|nextcloud|apple photos|flickr|one ?drive")) },
  { id: 'albums', label: 'Builds albums / favourites to find things later', re: rx("\\b(?:put (?:them )?in (?:an )?album|created? (?:an )?album|add(?:ed)? to (?:an )?album|favou?rites?|starred|bookmark|pin(?:ned)?)\\b") },
  { id: 'export', label: 'Exports / downloads everything (Takeout, local copy)', re: rx(W("takeout|export(?:ed|ing)? (?:all|everything|my|the|photos)|download(?:ed|ing)? (?:all|everything|them)|local copy|back(?:ed)? ?up (?:to|on) (?:a |my )?(?:hard|external|nas|computer|pc)")) },
  { id: 'ask_others', label: 'Asks someone / checks chats', re: rx("\\b(?:ask(?:ed|ing)? (?:my|a|someone|friends?|family)|check(?:ed|ing)? (?:whatsapp|my chats?|messages)|sent (?:it )?to (?:me|myself))\\b") },
];

function sentenceAround(t, m, span = 90) { return t.slice(Math.max(0, m.index - span), Math.min(t.length, m.index + m[0].length + span)); }

/* "finding X is hard / is easy" described in one clause (≤ 60 chars apart) */
const FIND_V = "search(?:es|ed|ing)?|find(?:ing)?|found|locat(?:e|ed|ing)|looking for|look for|scroll(?:ing)?|browse|browsing|retriev\\w+";
const FIND_STRUGGLE = rx("\\b(?:" + FIND_V + ")\\b[^.!?]{0,60}\\b(?:can'?t|cannot|couldn'?t|unable|hard|difficult|impossible|struggl\\w*|frustrat\\w*|annoy\\w*|no way|doesn'?t|won'?t|useless|terrible|awful|poor|bad|broken|missing|lost|gone|wish|no results|nothing|waste|stuck|fail\\w*|unusable|never|trouble|nightmare|pain)\\b|\\b(?:can'?t|cannot|couldn'?t|unable|hard|difficult|impossible|no way|struggl\\w*|trouble|wish|never|nightmare|pain)\\b[^.!?]{0,40}\\b(?:" + FIND_V + ")\\b");
const FIND_SUCCESS = rx("\\b(?:easy|easily|quick(?:ly)?|fast|love|great|amazing|awesome|perfect|helpful|magic(?:al)?|impressive|accurate|smart|brilliant|handy|convenient)\\b[^.!?]{0,40}\\b(?:" + FIND_V + ")\\b|\\b(?:" + FIND_V + ")\\b[^.!?]{0,40}\\b(?:easy|easily|quick(?:ly)?|fast|great|amazing|awesome|perfect|well|magic(?:al)?|impressive|accurate|brilliant|handy|convenient)\\b");
const NEEDS_FIND_SIGNAL = new Set(['backup_state', 'organization', 'edited_copies', 'deleted_trash', 'shared']);

function analyze(text, rating) {
  const t = NORM(text);
  const out = { retrieval: false, uiSeek: false, problems: [], content: [], clues: [], quotedQueries: [], forgot: [], behaviour: [], workarounds: [], old: false, forgotKinds: [], success: false, frags: {} };
  out.uiSeek = isUiSeek(t);
  if (!PHOTO_NOUN.test(t)) return out;
  const fs_ = FIND_STRUGGLE.test(t), fg = FIND_SUCCESS.test(t);
  for (const p of PROBLEMS) { if (p.re.some(r => r.test(t))) { if (NEEDS_FIND_SIGNAL.has(p.id) && !(R_VERB.test(t) && (fs_ || fg || CONTENT_NEAR.test(t)))) continue; out.problems.push(p.id); out.frags[p.id] = (p.re.map(r => r.exec(t)).find(Boolean) || [''])[0].slice(0, 140); } }
  if (rating != null && rating >= 4 && !STRUGGLE.test(t)) out.problems = out.problems.filter(x => x === 'ai_expectation' || x === 'personal_tags' || x === 'search_history');
  if (out.uiSeek && !out.problems.length && !/\bsearch\b/.test(t)) return out;      // looking for a button, not for content
  const generalStruggle = fs_ && CONTENT_NEAR.test(t);
  out.success = fg && CONTENT_NEAR.test(t) && !fs_;
  if (!out.problems.length && !generalStruggle && !out.success) return out;
  if (!out.problems.length && generalStruggle) out.problems.push('general_difficulty');
  out.retrieval = true;
  out.old = OLD.test(t);
  if (out.problems.includes('backup_state') && !(out.problems.includes('missing_photos') || out.problems.includes('search_quality') || /\bcan'?t find|cannot find|not (?:showing|there|found)\b/.test(t))) out.problems = out.problems.filter(x => x !== 'backup_state');
  for (const c of CONTENT) if (c.re.test(t)) out.content.push(c.id);
  // clues: look at what follows "search/filter by …" and classify the object phrase
  let m; CLUE_LEAD.lastIndex = 0; const seen = new Set();
  while ((m = CLUE_LEAD.exec(t))) { const frag = m[1]; for (const c of CLUES) if (c.re.test(frag) && !seen.has(c.id)) { seen.add(c.id); out.clues.push(c.id); } }
  QUOTED.lastIndex = 0; while ((m = QUOTED.exec(String(text).replace(/[’‘]/g, "'")))) out.quotedQueries.push(m[1].trim());
  FORGOT_LEAD.lastIndex = 0; while ((m = FORGOT_LEAD.exec(t))) { const frag = m[0]; for (const [k, re] of FORGOT_KIND) if (re.test(frag) && !out.forgotKinds.includes(k)) out.forgotKinds.push(k); out.forgot.push(frag.slice(0, 120)); }
  for (const b of BEHAVIOUR) if (b.re.test(t)) out.behaviour.push(b.id);
  for (const w of WORKAROUND) if (w.re.test(t)) out.workarounds.push(w.id);
  return out;
}

/* classify a quoted query string */
function classifyQuery(q) {
  const s = q.trim(), l = s.toLowerCase(), words = l.split(/\s+/).filter(Boolean);
  if (/\d{4}|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b\d{1,2}[\/\-.]\d{1,2}\b/.test(l)) return 'date';
  if (words.length >= 4) return 'description';
  if (/\b(my|me|mom|dad|wife|husband|friend|baby|son|daughter|sister|brother)\b/.test(l)) return 'person';
  if (/^[A-Z][a-z]+( [A-Z][a-z]+)?$/.test(s)) return 'proper_noun';
  if (/\b(screenshot|video|selfie|receipt|document|passport|id|pdf|text)\b/.test(l)) return 'type';
  return 'object_or_keyword';
}

module.exports = { clean, valence, STRUGGLE, SUCCESS, NORM, PROBLEMS, CONTENT, CLUES, BEHAVIOUR, WORKAROUND, FORGOT_KIND, OLD, analyze, isRetrieval, isUiSeek, classifyQuery, sentenceAround };
