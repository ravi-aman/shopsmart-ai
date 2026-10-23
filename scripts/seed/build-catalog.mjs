// Builds apps/backend/src/main/resources/seed/catalog.json.
//
// Source 1: DummyJSON (https://dummyjson.com) — real product photos for fashion, groceries, beauty, decor, phones.
// Source 2: hand-written electronics, appliances, books and health devices with the detailed specs
//           the AI shopping assistant reasons over (e.g. LAP101 Dell Inspiron 15 from the brief).
//
// Output is committed so seeding is deterministic; re-run only to change the catalog:
//   node scripts/seed/build-catalog.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(import.meta.dirname, '../../apps/backend/src/main/resources/seed/catalog.json')

// ---------------------------------------------------------------- categories
const categories = [
  ['electronics', 'Electronics', null],
  ['laptops', 'Laptops', 'electronics'],
  ['smartphones', 'Smartphones', 'electronics'],
  ['tablets', 'Tablets', 'electronics'],
  ['audio', 'Headphones & Speakers', 'electronics'],
  ['mobile-accessories', 'Mobile Accessories', 'electronics'],
  ['fashion', 'Fashion', null],
  ['mens-clothing', "Men's Clothing", 'fashion'],
  ['womens-clothing', "Women's Clothing", 'fashion'],
  ['footwear', 'Footwear', 'fashion'],
  ['watches', 'Watches', 'fashion'],
  ['bags-jewellery', 'Bags & Jewellery', 'fashion'],
  ['eyewear', 'Eyewear', 'fashion'],
  ['home-appliances', 'Home Appliances', null],
  ['large-appliances', 'Large Appliances', 'home-appliances'],
  ['kitchen', 'Kitchen', 'home-appliances'],
  ['home-decor', 'Home Decor', 'home-appliances'],
  ['furniture', 'Furniture', 'home-appliances'],
  ['books', 'Books', null],
  ['programming-books', 'Programming', 'books'],
  ['ai-data-books', 'AI & Data', 'books'],
  ['business-books', 'Business & Self-help', 'books'],
  ['fiction-books', 'Fiction & Non-fiction', 'books'],
  ['healthcare', 'Healthcare', null],
  ['health-devices', 'Health Devices', 'healthcare'],
  ['personal-care', 'Personal Care', 'healthcare'],
  ['fragrances', 'Fragrances', 'healthcare'],
  ['groceries', 'Groceries', null],
  ['fresh-pantry', 'Fresh & Pantry', 'groceries'],
].map(([slug, name, parent], i) => ({ slug, name, parent, sortOrder: i }))

const dummyCategoryMap = {
  smartphones: ['smartphones', 'PHN'],
  tablets: ['tablets', 'TAB'],
  'mobile-accessories': ['mobile-accessories', 'ACC'],
  'mens-shirts': ['mens-clothing', 'FSH'],
  tops: ['womens-clothing', 'FSH'],
  'womens-dresses': ['womens-clothing', 'FSH'],
  'mens-shoes': ['footwear', 'FSH'],
  'womens-shoes': ['footwear', 'FSH'],
  'mens-watches': ['watches', 'WCH'],
  'womens-watches': ['watches', 'WCH'],
  'womens-bags': ['bags-jewellery', 'FSH'],
  'womens-jewellery': ['bags-jewellery', 'FSH'],
  sunglasses: ['eyewear', 'FSH'],
  'kitchen-accessories': ['kitchen', 'HOM'],
  'home-decoration': ['home-decor', 'HOM'],
  furniture: ['furniture', 'HOM'],
  beauty: ['personal-care', 'HLT'],
  'skin-care': ['personal-care', 'HLT'],
  fragrances: ['fragrances', 'HLT'],
  groceries: ['fresh-pantry', 'GRO'],
}

// ---------------------------------------------------------------- hand-written products
const laptop = (id, name, brand, price, s, description, extra = {}) => ({
  id, name, brand, price, category: 'laptops', description,
  specs: { type: 'Laptop', ...s }, tags: extra.tags ?? [], mrp: extra.mrp,
})
const L = (cpu, ramGb, storageGb, gpu, displayInches, weightKg, batteryHours, os, more = {}) =>
  ({ cpu, ramGb, storageGb, storageType: 'SSD', gpu, displayInches, weightKg, batteryHours, os, ...more })

const crafted = [
  laptop('LAP101', 'Dell Inspiron 15', 'Dell', 899, L('Intel Core i7-1355U (10 cores)', 16, 512, 'Intel Iris Xe', 15.6, 1.65, 8, 'Windows 11 Home'),
    'Everyday 15.6" FHD laptop with a 13th-gen Core i7, 16GB DDR4 RAM and a fast 512GB NVMe SSD. Comfortable full-size keyboard with numpad.', { mrp: 1049, tags: ['developer', 'student', 'office'] }),
  laptop('LAP102', 'Lenovo IdeaPad Slim 5 14', 'Lenovo', 799, L('AMD Ryzen 7 7730U (8 cores)', 16, 512, 'AMD Radeon Graphics', 14, 1.46, 10, 'Windows 11 Home'),
    'Slim aluminium 14" laptop with an 8-core Ryzen 7, 16GB RAM and all-day battery. Great for coding on the move.', { mrp: 899, tags: ['developer', 'portable'] }),
  laptop('LAP103', 'HP Pavilion 15', 'HP', 649, L('Intel Core i5-1335U (10 cores)', 8, 512, 'Intel Iris Xe', 15.6, 1.75, 7, 'Windows 11 Home'),
    'Affordable 15.6" laptop for study and office work with a 13th-gen Core i5 and 512GB SSD.', { tags: ['student', 'office'] }),
  laptop('LAP104', 'ASUS TUF Gaming A15', 'ASUS', 999, L('AMD Ryzen 7 7735HS (8 cores)', 16, 512, 'NVIDIA GeForce RTX 4050 6GB', 15.6, 2.2, 6, 'Windows 11 Home', { refreshHz: 144 }),
    'Military-grade durable gaming laptop with an RTX 4050 GPU — handles CUDA workloads, ML coursework and modern games.', { mrp: 1199, tags: ['gaming', 'ai', 'gpu'] }),
  laptop('LAP105', 'Acer Nitro V 15', 'Acer', 849, L('Intel Core i5-13420H (8 cores)', 16, 512, 'NVIDIA GeForce RTX 4050 6GB', 15.6, 2.1, 5, 'Windows 11 Home', { refreshHz: 144 }),
    'Entry gaming laptop with RTX 4050 and 144Hz display. A budget way to get a CUDA-capable GPU.', { tags: ['gaming', 'ai', 'gpu'] }),
  laptop('LAP106', 'MSI Thin GF63', 'MSI', 1099, L('Intel Core i7-12650H (10 cores)', 16, 512, 'NVIDIA GeForce RTX 4060 8GB', 15.6, 1.86, 5, 'Windows 11 Home', { refreshHz: 144 }),
    'Thin gaming laptop with an RTX 4060 8GB for heavier GPU workloads.', { tags: ['gaming', 'ai', 'gpu'] }),
  laptop('LAP107', 'Apple MacBook Air 13 (M3)', 'Apple', 1099, L('Apple M3 (8-core CPU)', 16, 256, 'Apple 10-core GPU', 13.6, 1.24, 18, 'macOS'),
    'Fanless, silent and light with 18-hour battery. Unified memory keeps large IDE projects smooth.', { tags: ['developer', 'portable', 'premium'] }),
  laptop('LAP108', 'Apple MacBook Air 13 (M2)', 'Apple', 899, L('Apple M2 (8-core CPU)', 8, 256, 'Apple 8-core GPU', 13.6, 1.24, 18, 'macOS'),
    'The M2 MacBook Air: excellent battery and build. 8GB memory is fine for light development.', { mrp: 999, tags: ['portable', 'student'] }),
  laptop('LAP109', 'Lenovo ThinkPad E14 Gen 5', 'Lenovo', 949, L('Intel Core i7-1355U (10 cores)', 16, 512, 'Intel Iris Xe', 14, 1.41, 9, 'Windows 11 Pro'),
    'Business ThinkPad with legendary keyboard, upgradable RAM and Windows 11 Pro. A developer favourite.', { tags: ['developer', 'business'] }),
  laptop('LAP110', 'HP Victus 15', 'HP', 749, L('AMD Ryzen 5 7535HS (6 cores)', 16, 512, 'NVIDIA GeForce RTX 3050 4GB', 15.6, 2.29, 6, 'Windows 11 Home', { refreshHz: 144 }),
    'Budget gaming laptop with an RTX 3050 for entry-level GPU computing.', { tags: ['gaming', 'gpu'] }),
  laptop('LAP111', 'ASUS Vivobook 16', 'ASUS', 549, L('Intel Core i5-1235U (10 cores)', 8, 512, 'Intel Iris Xe', 16, 1.88, 7, 'Windows 11 Home'),
    'Large 16" screen for multitasking at an entry price.', { tags: ['student', 'office'] }),
  laptop('LAP112', 'Acer Aspire 5', 'Acer', 629, L('Intel Core i5-1335U (10 cores)', 16, 512, 'Intel Iris Xe', 15.6, 1.76, 8, 'Windows 11 Home'),
    'Value laptop with 16GB RAM — a sensible choice for programming on a budget.', { tags: ['developer', 'student'] }),
  laptop('LAP113', 'Dell XPS 14', 'Dell', 1899, L('Intel Core Ultra 7 155H (16 cores)', 32, 1024, 'NVIDIA GeForce RTX 4050 6GB', 14.5, 1.68, 12, 'Windows 11 Home', { npu: true }),
    'Premium creator laptop with OLED option, 32GB RAM, RTX 4050 and an on-device NPU.', { tags: ['premium', 'ai', 'creator'] }),
  laptop('LAP114', 'Lenovo Legion 5 Pro', 'Lenovo', 1599, L('AMD Ryzen 7 7745HX (8 cores)', 32, 1024, 'NVIDIA GeForce RTX 4070 8GB', 16, 2.5, 5, 'Windows 11 Home', { refreshHz: 240 }),
    'High-performance 16" laptop for serious ML training and gaming.', { tags: ['gaming', 'ai', 'gpu'] }),
  laptop('LAP115', 'HP Envy x360 14', 'HP', 949, L('Intel Core Ultra 5 125U (12 cores)', 16, 512, 'Intel Graphics', 14, 1.39, 11, 'Windows 11 Home', { convertible: true, npu: true }),
    'Convertible 2-in-1 with touch OLED and pen support.', { tags: ['portable', 'creator'] }),
  laptop('LAP116', 'Samsung Galaxy Book4', 'Samsung', 699, L('Intel Core 5 120U (10 cores)', 8, 512, 'Intel Graphics', 15.6, 1.55, 9, 'Windows 11 Home'),
    'Slim everyday laptop that pairs with Galaxy phones.', { tags: ['office', 'student'] }),
  laptop('LAP117', 'ASUS ROG Zephyrus G14', 'ASUS', 1799, L('AMD Ryzen 9 8945HS (8 cores)', 32, 1024, 'NVIDIA GeForce RTX 4070 8GB', 14, 1.5, 9, 'Windows 11 Home', { refreshHz: 120 }),
    'Compact 14" powerhouse with OLED display and RTX 4070.', { tags: ['gaming', 'ai', 'premium', 'gpu'] }),
  laptop('LAP118', 'Lenovo IdeaPad Gaming 3', 'Lenovo', 599, L('AMD Ryzen 5 7535HS (6 cores)', 8, 512, 'NVIDIA GeForce RTX 2050 4GB', 15.6, 2.32, 6, 'Windows 11 Home'),
    'Lowest-cost way into a discrete NVIDIA GPU; 8GB RAM limits heavier workloads.', { tags: ['gaming', 'gpu'] }),
  laptop('LAP119', 'Microsoft Surface Laptop 7 13.8"', 'Microsoft', 999, L('Snapdragon X Plus (10 cores)', 16, 512, 'Qualcomm Adreno', 13.8, 1.34, 20, 'Windows 11 Home (Arm)', { npu: true }),
    'Arm-based Copilot+ PC with excellent battery. Some x86-only developer tools run under emulation.', { tags: ['portable', 'ai'] }),
  laptop('LAP120', 'Dell Inspiron 14 Plus', 'Dell', 1049, L('Intel Core Ultra 7 155H (16 cores)', 16, 1024, 'Intel Arc Graphics', 14, 1.6, 10, 'Windows 11 Home', { npu: true }),
    'Performance 14" with Core Ultra 7, 1TB SSD and an NPU for on-device AI features.', { tags: ['developer', 'ai'] }),
  laptop('LAP121', 'Acer Swift Go 14', 'Acer', 799, L('Intel Core Ultra 5 125H (14 cores)', 16, 512, 'Intel Arc Graphics', 14, 1.32, 10, 'Windows 11 Home', { npu: true }),
    'Light 14" OLED laptop with Core Ultra 5 and 16GB RAM.', { tags: ['developer', 'portable'] }),
  laptop('LAP122', 'Lenovo IdeaPad Flex 5 Chromebook', 'Lenovo', 429, L('Intel Core i3-1215U (6 cores)', 8, 128, 'Intel UHD Graphics', 14, 1.55, 10, 'ChromeOS', { storageType: 'eMMC' }),
    'Convertible Chromebook for browsing and schoolwork. Not suited to local IDEs or AI tooling.', { tags: ['student'] }),

  // phones
  ...[
    ['PHN101', 'Samsung Galaxy S25', 'Samsung', 799, { chipset: 'Snapdragon 8 Elite', ramGb: 12, storageGb: 128, displayInches: 6.2, batteryMah: 4000, mainCameraMp: 50, os: 'Android 15' }, 'Compact flagship with Galaxy AI features and 7 years of OS updates.'],
    ['PHN102', 'Google Pixel 9a', 'Google', 499, { chipset: 'Google Tensor G4', ramGb: 8, storageGb: 128, displayInches: 6.3, batteryMah: 5100, mainCameraMp: 48, os: 'Android 15' }, 'Best-value Pixel with excellent camera processing and clean Android.'],
    ['PHN103', 'OnePlus 13R', 'OnePlus', 599, { chipset: 'Snapdragon 8 Gen 3', ramGb: 12, storageGb: 256, displayInches: 6.78, batteryMah: 6000, mainCameraMp: 50, os: 'Android 15' }, 'Flagship-class performance and a huge 6000mAh battery with fast charging.'],
    ['PHN104', 'Apple iPhone 16', 'Apple', 799, { chipset: 'Apple A18', ramGb: 8, storageGb: 128, displayInches: 6.1, batteryMah: 3561, mainCameraMp: 48, os: 'iOS 18' }, 'iPhone 16 with Camera Control and Apple Intelligence.'],
    ['PHN105', 'Xiaomi Redmi Note 14 Pro', 'Xiaomi', 329, { chipset: 'MediaTek Dimensity 7300 Ultra', ramGb: 8, storageGb: 256, displayInches: 6.67, batteryMah: 5110, mainCameraMp: 200, os: 'Android 14' }, 'Mid-range phone with a 200MP main camera and AMOLED display.'],
  ].map(([id, name, brand, price, s, description]) => ({ id, name, brand, price, category: 'smartphones', description, specs: { type: 'Smartphone', ...s }, tags: ['5g'] })),

  // audio
  ...[
    ['AUD101', 'Sony WH-1000XM5', 'Sony', 349, { formFactor: 'Over-ear', noiseCancelling: true, batteryHours: 30, connectivity: 'Bluetooth 5.2' }, 'Industry-leading noise cancelling headphones for focus and travel.'],
    ['AUD102', 'Apple AirPods Pro 2 (USB-C)', 'Apple', 249, { formFactor: 'In-ear', noiseCancelling: true, batteryHours: 6, connectivity: 'Bluetooth 5.3' }, 'Active noise cancellation, adaptive audio and USB-C charging case.'],
    ['AUD103', 'Bose QuietComfort Ultra Headphones', 'Bose', 429, { formFactor: 'Over-ear', noiseCancelling: true, batteryHours: 24, connectivity: 'Bluetooth 5.3' }, 'Premium comfort with immersive spatial audio.'],
    ['AUD104', 'JBL Flip 6', 'JBL', 129, { formFactor: 'Portable speaker', waterproof: 'IP67', batteryHours: 12, connectivity: 'Bluetooth 5.1' }, 'Rugged waterproof speaker with punchy sound.'],
    ['AUD105', 'Samsung Galaxy Buds3 Pro', 'Samsung', 249, { formFactor: 'In-ear', noiseCancelling: true, batteryHours: 6, connectivity: 'Bluetooth 5.4' }, 'Blade-design earbuds with intelligent ANC.'],
  ].map(([id, name, brand, price, s, description]) => ({ id, name, brand, price, category: 'audio', description, specs: { type: 'Audio', ...s }, tags: [] })),

  // large appliances
  ...[
    ['APL101', 'LG 8 kg Front Load Washing Machine', 'LG', 549, { capacityKg: 8, energyRating: '5 Star', motor: 'Inverter Direct Drive', programs: 14 }, 'AI Direct Drive washer that senses fabric type and load.'],
    ['APL102', 'Samsung 653 L Side-by-Side Refrigerator', 'Samsung', 1199, { capacityLitres: 653, energyRating: '3 Star', compressor: 'Digital Inverter', convertible: true }, 'Large side-by-side fridge with convertible freezer modes.'],
    ['APL103', 'Daikin 1.5 Ton 5 Star Inverter Split AC', 'Daikin', 649, { capacityTon: 1.5, energyRating: '5 Star', refrigerant: 'R32', copperCondenser: true }, 'Efficient inverter AC with PM2.5 filter.'],
    ['APL104', 'Philips 4.1 L Air Fryer HD9252', 'Philips', 119, { capacityLitres: 4.1, powerWatts: 1400, presets: 7 }, 'Rapid Air technology for crispy food with little oil.'],
    ['APL105', 'IFB 30 L Convection Microwave', 'IFB', 229, { capacityLitres: 30, type: 'Convection', autoCookMenus: 101 }, 'Convection microwave for baking, grilling and reheating.'],
    ['APL106', 'Dyson V12 Detect Slim Cordless Vacuum', 'Dyson', 649, { runtimeMinutes: 60, binLitres: 0.35, filtration: 'HEPA' }, 'Laser dust detection and piezo sensor counting particles.'],
    ['APL107', 'Kent Grand Plus RO Water Purifier', 'Kent', 199, { capacityLitres: 9, technology: 'RO + UV + UF', tdsControl: true }, 'Multi-stage purification with mineral retention.'],
  ].map(([id, name, brand, price, s, description]) => ({ id, name, brand, price, category: 'large-appliances', description, specs: { type: 'Appliance', ...s }, tags: [] })),

  // books
  ...[
    ['BOK101', 'Effective Java (3rd Edition)', 'Addison-Wesley', 45, 'programming-books', { author: 'Joshua Bloch', pages: 412, format: 'Paperback' }, 'Best practices for the Java platform, covering Java 7, 8 and 9 features.'],
    ['BOK102', 'Spring in Action (6th Edition)', 'Manning', 49, 'programming-books', { author: 'Craig Walls', pages: 520, format: 'Paperback' }, 'Hands-on guide to Spring and Spring Boot for building web apps and services.'],
    ['BOK103', 'Clean Code', 'Prentice Hall', 38, 'programming-books', { author: 'Robert C. Martin', pages: 464, format: 'Paperback' }, 'A handbook of agile software craftsmanship.'],
    ['BOK104', 'The Pragmatic Programmer (20th Anniversary)', 'Addison-Wesley', 42, 'programming-books', { author: 'David Thomas, Andrew Hunt', pages: 352, format: 'Hardcover' }, 'Timeless advice for developers on craft and career.'],
    ['BOK105', 'Designing Data-Intensive Applications', "O'Reilly", 55, 'ai-data-books', { author: 'Martin Kleppmann', pages: 616, format: 'Paperback' }, 'The big ideas behind reliable, scalable and maintainable systems.'],
    ['BOK106', 'Hands-On Machine Learning (3rd Edition)', "O'Reilly", 65, 'ai-data-books', { author: 'Aurélien Géron', pages: 864, format: 'Paperback' }, 'Practical ML with Scikit-Learn, Keras and TensorFlow.'],
    ['BOK107', 'AI Engineering', "O'Reilly", 60, 'ai-data-books', { author: 'Chip Huyen', pages: 532, format: 'Paperback' }, 'Building applications with foundation models: evaluation, RAG, agents and more.'],
    ['BOK108', 'Deep Learning', 'MIT Press', 80, 'ai-data-books', { author: 'Ian Goodfellow, Yoshua Bengio, Aaron Courville', pages: 800, format: 'Hardcover' }, 'The foundational textbook on deep learning.'],
    ['BOK109', 'Atomic Habits', 'Avery', 18, 'business-books', { author: 'James Clear', pages: 320, format: 'Hardcover' }, 'Tiny changes, remarkable results.'],
    ['BOK110', 'The Psychology of Money', 'Harriman House', 16, 'business-books', { author: 'Morgan Housel', pages: 256, format: 'Paperback' }, 'Timeless lessons on wealth, greed and happiness.'],
    ['BOK111', 'Project Hail Mary', 'Ballantine Books', 19, 'fiction-books', { author: 'Andy Weir', pages: 496, format: 'Paperback' }, 'A lone astronaut must save the earth from disaster.'],
    ['BOK112', 'Sapiens', 'Harper', 22, 'fiction-books', { author: 'Yuval Noah Harari', pages: 464, format: 'Paperback' }, 'A brief history of humankind.'],
  ].map(([id, name, brand, price, category, s, description]) => ({ id, name, brand, price, category, description, specs: { type: 'Book', ...s }, tags: [] })),

  // health devices
  ...[
    ['HLT101', 'Omron HEM-7120 Blood Pressure Monitor', 'Omron', 39, { measurement: 'Upper arm', memory: 30, power: '4 x AA' }, 'Clinically validated automatic BP monitor with IntelliSense.'],
    ['HLT102', 'Braun ThermoScan 7 Ear Thermometer', 'Braun', 59, { measurement: 'Ear', ageAdjusted: true, readingSeconds: 1 }, 'Age Precision technology with pre-warmed tip.'],
    ['HLT103', 'Dr Trust Fingertip Pulse Oximeter', 'Dr Trust', 25, { measures: 'SpO2, pulse rate', display: 'OLED' }, 'Quick SpO2 and pulse readings at home.'],
    ['HLT104', 'Accu-Chek Instant Glucometer Kit', 'Accu-Chek', 29, { testTimeSeconds: 4, memory: 720, connectivity: 'Bluetooth' }, 'Simple blood glucose testing with app sync.'],
  ].map(([id, name, brand, price, s, description]) => ({ id, name, brand, price, category: 'health-devices', description, specs: { type: 'Health device', ...s }, tags: [] })),
]

// Specs for the five DummyJSON laptops (their source data has none).
const dummyLaptopSpecs = {
  'Apple MacBook Pro 14 Inch Space Grey': L('Apple M1 Pro (10-core CPU)', 16, 512, 'Apple 16-core GPU', 14.2, 1.6, 17, 'macOS'),
  'Asus Zenbook Pro Dual Screen Laptop': L('Intel Core i9-10980HK (8 cores)', 32, 1024, 'NVIDIA GeForce RTX 2060 6GB', 15.6, 2.5, 5, 'Windows 11 Home'),
  'Huawei Matebook X Pro': L('Intel Core i7-1360P (12 cores)', 16, 1024, 'Intel Iris Xe', 14.2, 1.26, 11, 'Windows 11 Home'),
  'Lenovo Yoga 920': L('Intel Core i7-8550U (4 cores)', 8, 256, 'Intel UHD 620', 13.9, 1.37, 10, 'Windows 11 Home', { convertible: true }),
  'New DELL XPS 13 9300': L('Intel Core i7-1065G7 (4 cores)', 16, 512, 'Intel Iris Plus', 13.4, 1.27, 12, 'Windows 11 Home'),
}

// ---------------------------------------------------------------- helpers
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
// Deterministic pseudo-random from a string, 0..1
const rand = (seed) => {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h >>> 0) % 10000) / 10000
}
const round2 = (n) => Math.round(n * 100) / 100

// ---------------------------------------------------------------- build
const res = await fetch('https://dummyjson.com/products?limit=0')
const { products: dummy } = await res.json()

const counters = {}
const nextId = (prefix) => {
  counters[prefix] = (counters[prefix] ?? 200) + 1
  return `${prefix}${counters[prefix]}`
}

const products = []
for (const p of dummy) {
  let target = dummyCategoryMap[p.category]
  let specs = {}
  if (p.category === 'laptops') {
    target = ['laptops', 'LAP']
    specs = { type: 'Laptop', ...dummyLaptopSpecs[p.title] }
  }
  if (!target) continue // vehicles, motorcycles, sports accessories: out of scope
  const [category, prefix] = target
  if (p.weight) specs.weightKg ??= p.weight
  if (p.dimensions) specs.dimensionsCm = `${p.dimensions.width} x ${p.dimensions.height} x ${p.dimensions.depth}`
  products.push({
    id: nextId(prefix),
    name: p.title,
    brand: p.brand ?? 'ShopSmart Basics',
    price: round2(p.price),
    mrp: p.discountPercentage > 1 ? round2(p.price / (1 - p.discountPercentage / 100)) : undefined,
    category,
    description: p.description,
    specs,
    tags: p.tags ?? [],
    rating: Math.round(p.rating * 10) / 10,
    images: p.images,
  })
}

for (const p of crafted) {
  products.push({
    ...p,
    rating: Math.round((3.6 + rand(p.id) * 1.3) * 10) / 10,
    images: [],
  })
}

for (const p of products) {
  p.slug = `${slugify(p.name)}-${p.id.toLowerCase()}`
  p.ratingCount = Math.round(40 + rand(p.id + 'rc') * 4000)
  if (p.mrp && p.mrp <= p.price) delete p.mrp
}

const warehouses = [
  { id: 'WH-MUM', name: 'Mumbai Fulfilment Centre', city: 'Mumbai', region: 'IN-WEST' },
  { id: 'WH-DEL', name: 'Delhi NCR Fulfilment Centre', city: 'Gurugram', region: 'IN-NORTH' },
  { id: 'WH-BLR', name: 'Bengaluru Fulfilment Centre', city: 'Bengaluru', region: 'IN-SOUTH' },
  { id: 'WH-KOL', name: 'Kolkata Fulfilment Centre', city: 'Kolkata', region: 'IN-EAST' },
  { id: 'WH-HYD', name: 'Hyderabad Fulfilment Centre', city: 'Hyderabad', region: 'IN-SOUTH' },
]

// Stock: most items stocked, ~8% fully out of stock, ~10% low.
const inventory = []
for (const p of products) {
  const r = rand(p.id + 'stock')
  for (const w of warehouses) {
    const rw = rand(p.id + w.id)
    let onHand
    if (r < 0.08) onHand = 0
    else if (r < 0.18) onHand = rw < 0.6 ? 0 : Math.ceil(rw * 4)
    else onHand = rw < 0.15 ? 0 : Math.round(5 + rw * 60)
    inventory.push({ productId: p.id, warehouseId: w.id, onHand, reorderPoint: 5 })
  }
}
// The brief's example product must be available.
for (const row of inventory) if (row.productId === 'LAP101') row.onHand = Math.max(row.onHand, 25)

const brands = [...new Set(products.map((p) => p.brand))].sort()

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ categories, brands, warehouses, products, inventory }, null, 1))
console.log(`Wrote ${products.length} products, ${brands.length} brands, ${inventory.length} inventory rows -> ${OUT}`)
