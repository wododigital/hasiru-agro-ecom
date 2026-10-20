// Step 9.10: CMS seed. Home blocks, farm development pages, about, contact, why choose us, menus,
// testimonials (3) and team (4) from the current hasiruagro.com site, trust claims and counters. Policy
// pages hold only the sentences the SRS has (plus a contact line where the SRS has none); they are published
// because the footer links them, and stay noindex until the client sends the full text.
// Copy follows the site rules: no em or en dashes, no "phase" wording (the old site's "Phase One" steps are
// "Step 1" here).
import { join } from 'node:path';
// @boundaries-ignore type-only: the seed-hook contract; @tooling/scripts cannot depend on core (core depends on it for db helpers)
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { once, SOURCES, writeSeedFile } from './lib/common';
import { siteMaster } from './lib/media-plan';

interface Block {
  type: string;
  props: Record<string, unknown>;
  sort: number;
}
interface Page {
  slug: string;
  title: string;
  status: 'draft' | 'published';
  noindex: boolean;
  blocks: Block[];
  seo: { title: string; description: string };
}

/** Master path of a current-site image (by its file name in images/). */
function img(name: string): string {
  const m = siteMaster(name);
  if (!m) throw new Error(`site image missing: ${name}`);
  return m.file;
}
const blocks = (...b: [string, Record<string, unknown>][]): Block[] => b.map(([type, props], i) => ({ type, props, sort: i + 1 }));
const page = (slug: string, title: string, seoTitle: string, description: string, b: Block[], noindex = false): Page => ({
  slug, title, status: 'published', noindex, blocks: b, seo: { title: seoTitle, description },
});
// Blocks use the cms module's vocabulary (packages/cms/src/domain/blocks.ts): hero, rich_text, cta, rail, video,
// trust_band, testimonials, team. Images are master paths; the cms seed hook turns them into media ids.
type B = [string, Record<string, unknown>];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** `rich_text`: optional heading, paragraphs (plain text, or ready html when it starts with `<`) and titled points. */
const richText = (heading: string | null, paras: string[], points: { title: string; text?: string }[] = []): B => [
  'rich_text',
  {
    html: [
      heading ? `<h2>${esc(heading)}</h2>` : '',
      ...paras.map((t) => (t.startsWith('<') ? t : `<p>${esc(t)}</p>`)),
      points.length ? `<ul>${points.map((pt) => `<li><strong>${esc(pt.title)}</strong>${pt.text ? `: ${esc(pt.text)}` : ''}</li>`).join('')}</ul>` : '',
    ].join(''),
  },
];
/** `rail` of the five farm development steps. */
const processRail = (heading?: string): B => ['rail', { ...(heading ? { heading } : {}), items: PROCESS.map((st) => ({ title: `Step ${st.step}: ${st.title}`, href: st.href, caption: st.text, image: img(st.image) })) }];
/** `cta` to the farm development enquiry; the copy is the /build-farm-with-us page's own. */
const ENQUIRY_CTA: B = ['cta', { heading: 'Build your farm with us', body: 'Share a few details about your land. Our team calls you within one working day to plan a site visit.', label: 'Tell us about your land', href: '/build-farm-with-us' }];
/** Body for a policy page the SRS has no text for yet. */
const PENDING_POLICY = blocks(richText(null, ['The full policy is being prepared. For any question, call +91 81051 00749 or email contact@hasiruagro.com.']));

const PROCESS = [
  { step: 1, title: 'Site assessment', text: 'Soil, water and climate study on your land.', image: 'process_site_assessment_field_survey_hasiru_agro.webp', href: '/farm-development/site-assessment' },
  { step: 2, title: 'Satellite mapping', text: 'NDVI and contour maps of every part of the land.', image: 'process_satellite_topographical_map_hasiru_agro.webp', href: '/farm-development/design' },
  { step: 3, title: 'Earthwork', text: 'Swales, basins and irrigation laid along the contours.', image: 'process_earthwork_aerial_swales_basin_hasiru_agro.webp', href: '/farm-development/earthwork' },
  { step: 4, title: 'Planting', text: '200+ varieties planted in layers.', image: 'process_planting_coconut_sapling_hasiru_agro.webp', href: '/farm-development/planting' },
  { step: 5, title: 'Management', text: 'Ongoing care through to harvest.', image: 'process_harvest_jackfruit_farmer_hasiru_agro.webp', href: '/farm-development' },
];

const WHY = [
  { title: 'Intelligent farm design', text: 'Satellite mapping, contour analysis and a layout made for your land: its slope, soil and water flow.' },
  { title: '200+ native varieties', text: 'Saplings from our own nursery. No middlemen; every sapling is traceable and acclimatised.' },
  { title: 'Full-time farm team', text: 'Trained agronomists and field staff, not freelancers. Every visit is documented.' },
  { title: 'Radical transparency', text: 'Photo reports, GPS-tagged visits and monthly activity logs, so you always know what is happening on your farm.' },
  { title: '30-year vision', text: 'Every tree placement plans for its 30-year canopy, shade and yield cycle.' },
];

const SERVICES: { slug: string; title: string; intro: string; points: { title: string; text: string }[]; image: string }[] = [
  {
    slug: 'site-assessment', title: 'Site assessment',
    intro: 'Our agronomists walk your land and study soil texture, water sources, slope and microclimate. Everything else is built on this.',
    points: [
      { title: 'Soil analysis', text: 'Samples from several points for pH, organic matter, nutrients and microbial activity.' },
      { title: 'Water source mapping', text: 'Borewells, springs, seasonal streams and the rainfall pattern.' },
      { title: 'Microclimate study', text: 'Sun exposure, wind, frost pockets and shade across the seasons.' },
    ],
    image: 'site_analysis_soil_testing_sample_hasiru_agro.webp',
  },
  {
    slug: 'design', title: 'Farm design',
    intro: 'Satellite imagery, NDVI analysis and contour maps turn into a complete layout: every swale, bund, tree row and planting zone placed along the natural contour.',
    points: [
      { title: 'NDVI vegetation analysis', text: 'Colour-coded maps of plant health, bare spots and biological activity.' },
      { title: 'Elevation and slope mapping', text: 'Topographic data down to 30 cm changes in elevation.' },
      { title: 'Keyline design', text: 'Swales and bunds on the keylines to hold the most moisture.' },
      { title: 'Zonal planting plan', text: 'Fruit, timber, spice and forest zones placed by sun, wind and water access.' },
    ],
    image: 'design_farm_blueprint_zonal_plan_hasiru_agro.webp',
  },
  {
    slug: 'water-management', title: 'Water management',
    intro: 'Rainwater is slowed, sunk and spread across the land, so the farm handles both drought and heavy rain by design.',
    points: [
      { title: 'Bio-swales', text: 'Rainwater harvesting structures along the contour lines.' },
      { title: 'Basins', text: 'Hold moisture at the root zone of each plant.' },
      { title: 'Drip irrigation', text: 'Water delivered by zone, with nothing wasted.' },
      { title: 'Fertigation setup', text: 'Drum, venturi and shade structure for mixing nutrients into the drip.' },
    ],
    image: 'water_harvesting_pond_excavation_hasiru_agro.webp',
  },
  {
    slug: 'earthwork', title: 'Earthwork and land preparation',
    intro: 'Swales to harvest rainwater, basins for moisture, ponds for the microclimate and terraces for slopes. Every cubic foot of earth moved has an ecological purpose.',
    points: [
      { title: 'Bio-swales and basins', text: 'Structures that slow, sink and spread water across the contour lines.' },
      { title: 'Ponds', text: 'Water storage that also cools the microclimate.' },
      { title: 'Boundary and wind breaks', text: 'Tabebuia, Pongamia, bamboo and mahogany as natural boundaries.' },
    ],
    image: 'earthwork_swale_trench_digging_hasiru_agro.webp',
  },
  {
    slug: 'planting', title: 'Planting',
    intro: 'Multi-layer planting from our own nursery: boundary trees, green manure, quick-yield crops, fruit trees and timber, each in the right zone.',
    points: [
      { title: 'Boundary plantation', text: 'Tabebuia, Pongamia, wild badam, bamboo and mahogany for wind breaks and privacy.' },
      { title: 'Green manure', text: 'Sesbania, Gliricidia, Moringa, Vetiver and Lemongrass for organic matter.' },
      { title: 'Short-term yield', text: 'Lemon, banana, papaya, pineapple and mulberry for early returns.' },
      { title: 'Fruiting plants', text: 'Jackfruit, avocado, litchi, orange and musambi.' },
      { title: 'Timber trees', text: 'Mahogany, sandalwood, red sandal and rosewood as a long-term asset.' },
    ],
    image: 'planting_team_drip_line_execution_hasiru_agro.webp',
  },
];

export const buildCms = once(() => {
  const pages: Page[] = [
    page('home', 'Home', 'Plants, Saplings and Farm Development in Bengaluru | Hasiru Agro', 'Fruit, timber and native saplings from our Bengaluru nursery, with farm design and management for landowners across South India.', blocks(
      // The home hero is the app's own (two paths: shop or wizard). Product rails and the calculator teasers need
      // cms block types that call catalog and farm-calculators; until then the home shows the content blocks below.
      richText('Why choose us', [], WHY),
      ['video', { limit: 6 }],
      ['testimonials', { limit: 3 }],
      ['trust_band', {}],
      processRail('Farm development'),
    )),
    page('farm-development', 'Farm development', 'Farm Design, Setup and Management | Hasiru Agro', 'From barren land to a living farm: site assessment, satellite mapping, earthwork, planting and ongoing management by our own team.', blocks(
      ['hero', { heading: 'From barren land to living farm', subheading: 'We take your land through five steps and manage it until it sustains itself.', image: img('transformation_young_saplings_field_hasiru_agro.webp') }],
      processRail(),
      richText('Farm management, every season', [], [
        'Weed management', 'Fertigation', 'Natural pest management', 'Pruning and training', 'Composting', 'Mulching', 'Soil building',
        'Irrigation checks', 'Harvest coordination', 'Replanting', 'Documentation', 'Seasonal planning',
      ].map((title) => ({ title }))),
      ENQUIRY_CTA,
    )),
    ...SERVICES.map((s) =>
      page(`farm-development/${s.slug}`, s.title, `${s.title} | Hasiru Agro Farm Development`, s.intro.split('. ')[0]!.replace(/\.?$/, '.'), blocks(
        ['hero', { heading: s.title, subheading: s.intro, image: img(s.image) }],
        richText(null, [], s.points),
        ENQUIRY_CTA,
      )),
    ),
    page('about', 'About us', 'About Hasiru Agro | Our Mission, Team and Values', 'A team of agronomists, engineers and nature lovers making every farm a self-sustaining ecosystem.', blocks(
      ['hero', { heading: 'Born from the soil, built for the future', subheading: 'We are a team of agronomists, engineers and nature lovers on a mission to make every farm in India a self-sustaining ecosystem.' }],
      richText('Our vision', ['A self-sustaining farm on every piece of land: the land feeds the farmer, the farmer nurtures the land, and together they create abundance that lasts generations.']),
      richText('Our mission', ['To combine satellite technology, permaculture science and hands-on execution to turn any piece of land into a thriving, productive, self-sustaining farm. We handle everything from design to management.']),
      richText('Our values', [], [
        { title: 'Nature first', text: 'Every decision starts with what is best for the ecosystem. Zero chemicals, always.' },
        { title: 'Radical transparency', text: 'Every visit documented, every rupee accounted for, every decision explained.' },
        { title: 'Science over guesswork', text: 'Satellite data, contour maps and soil analysis: we design with data.' },
        { title: 'Complete ownership', text: 'We execute, manage and take full responsibility for your farm.' },
        { title: 'Community impact', text: 'Local employment, skills for rural youth and degraded land restored.' },
        { title: 'Long-term thinking', text: 'We design for decades: every farm is a 30-year asset.' },
      ]),
      ['team', {}],
      ['trust_band', {}],
    )),
    page('why-choose-us', 'Why choose us', 'Why Landowners Choose Hasiru Agro', 'Farm design from satellite data, saplings from our own nursery, a full-time farm team and transparent reporting.', blocks(
      richText(null, [], WHY),
      ['testimonials', { limit: 3 }],
    )),
    page('contact', 'Contact us', 'Contact Hasiru Agro | Nursery in Kengeri, Bengaluru', 'Call, email or visit our nursery near Komghatta Lake, Kengeri, Bengaluru. Open every day, 9:30 AM to 5:30 PM.', blocks(
      richText(null, [
        '<p><a href="tel:+918105100749">+91 81051 00749</a></p>',
        '<p><a href="mailto:contact@hasiruagro.com">contact@hasiruagro.com</a></p>',
        'Near Komghatta Lake, Tavarekere Main Road, Kengeri, Bangalore 560060',
        'Monday to Sunday, 9:30 AM to 5:30 PM',
      ]),
      ENQUIRY_CTA,
    )),
    // Policy pages: only what the SRS says. Published (the footer links them) but noindex until the client's text arrives.
    page('policies/cancellation-and-refund', 'Cancellation and refund policy', 'Cancellation and Refund Policy | Hasiru Agro', 'Cancellation or return of an order is not allowed.', blocks(
      richText(null, ['Cancellation or return of an order is not allowed.']),
    ), true),
    page('policies/damage-and-replacement', 'Damage and replacement policy', 'Damage and Replacement Policy | Hasiru Agro', 'Damage and replacement policy.', PENDING_POLICY, true),
    page('policies/delivery', 'Delivery policy', 'Delivery Policy | Hasiru Agro', 'Nursery pickup, scheduled weekly delivery in Bengaluru and outstation transport.', blocks(
      richText(null, ['Customers can choose nursery pickup or delivery. Within Bengaluru, deliveries are planned on a scheduled basis, once a week. Outstation transportation is calculated separately and considers distance and weight. Packing charges are calculated separately.']),
    ), true),
    page('policies/privacy', 'Privacy policy', 'Privacy Policy | Hasiru Agro', 'Privacy policy.', PENDING_POLICY, true),
    page('policies/terms', 'Terms and conditions', 'Terms and Conditions | Hasiru Agro', 'Terms and conditions.', PENDING_POLICY, true),
  ].sort((a, b) => a.slug.localeCompare(b.slug));

  const menus = [
    {
      key: 'footer',
      items: [
        { label: 'Timber trees', href: '/plants/timber', sort: 1 },
        { label: 'Fruiting trees', href: '/plants/fruiting', sort: 2 },
        { label: 'Other plants', href: '/plants/other', sort: 3 },
        { label: 'Inputs', href: '/inputs', sort: 4 },
        { label: 'Farm development', href: '/farm-development', sort: 5 },
        { label: 'About us', href: '/about', sort: 6 },
        { label: 'Why choose us', href: '/why-choose-us', sort: 7 },
        { label: 'Contact', href: '/contact', sort: 8 },
      ],
    },
    {
      key: 'header',
      items: [
        { label: 'Plants', href: '/plants', sort: 1 },
        { label: 'Inputs', href: '/inputs', sort: 2 },
        { label: 'Help me choose', href: '/plan', sort: 3 },
        { label: 'Farm development', href: '/farm-development', sort: 4 },
        { label: 'About', href: '/about', sort: 5 },
        { label: 'Contact', href: '/contact', sort: 6 },
      ],
    },
  ];

  // Real customer quotes from the current site (A13: nothing invented)
  const testimonials = [
    { key: 'rajesh-m', author: 'Rajesh M', location: null, body: "A very well maintained nursery with knowledgeable staff. I got fruit plants from here and they're all growing really well in our farm. Planning to visit again. Keep up the good work!", source: 'current_site', avatar: img('reviewer_rajesh_m_hasiru_agro.png'), sort: 2 },
    { key: 'sornah-pandian', author: 'Sornah Pandian', location: null, body: "This beautiful farm has a whole range of saplings, all naturally grown with a lustrous, healthy look. I'd recommend anyone to visit, enjoy the green view, and let them give you a tour with detailed explanations about each plant.", source: 'current_site', avatar: img('reviewer_sornah_pandian_hasiru_agro.png'), sort: 1 },
    { key: 'yash-shah', author: 'Yash Shah', location: null, body: 'Before visiting Hasiru Agro, I thought I knew farming. There is so much to learn. I found new and effective techniques that yield better results. Amazing quality saplings and really sweet people!', source: 'current_site', avatar: img('reviewer_yash_shah_hasiru_agro.png'), sort: 3 },
  ];
  const team = [
    { key: 'anirudh', name: 'Anirudh', role: 'Co-Founder', photo: img('team_anirudh_cofounder_hasiru_agro.webp'), sort: 1 },
    { key: 'arjun', name: 'Arjun', role: 'Co-Founder', photo: img('team_arjun_cofounder_hasiru_agro.webp'), sort: 2 },
    { key: 'shyam', name: 'Shyam', role: 'CTO', photo: img('team_shyam_cto_hasiru_agro.webp'), sort: 3 },
    { key: 'suhas', name: 'Suhas', role: 'CMO', photo: img('team_suhas_cmo_hasiru_agro.webp'), sort: 4 },
  ];
  const trust_claims = [
    { key: 'msme', label: 'MSME registered', logo: img('badge_msme_hasiru_agro.png'), visible: true },
    { key: 'rating', label: 'Rated 4.8', logo: null, visible: false },
    { key: 'startup-india', label: 'Recognised by Startup India', logo: img('badge_startup_india_hasiru_agro.jpg'), visible: true },
    { key: 'uasb-bionest', label: 'Incubated at UASB Bio-NEST, Bangalore', logo: img('incubated_uasb_bionest_hasiru_agro.webp'), visible: true },
  ];
  const counters = [
    { key: 'acres-transformed', label: 'Acres transformed', value: '850+', source: 'current_site', visible: true, sort: 1 },
    { key: 'farms-designed', label: 'Farms designed', value: '120+', source: 'current_site', visible: true, sort: 3 },
    { key: 'plant-varieties', label: 'Plant varieties', value: '200+', source: 'current_site', visible: true, sort: 2 },
  ];
  return { pages, menus, testimonials, team, trust_claims, counters };
});

export default async function step(ctx: SeedContext): Promise<void> {
  const cms = buildCms();
  writeSeedFile(join(ctx.seedDir, 'cms.json'), [SOURCES.site, SOURCES.srs, SOURCES.handoff], cms, ctx);
  ctx.log.info(`cms-content: ${cms.pages.length} pages (${cms.pages.filter((p) => p.noindex).length} noindex), ${cms.testimonials.length} testimonials, ${cms.team.length} team`);
}
