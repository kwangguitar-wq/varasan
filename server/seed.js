import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { db, nowIso, setDatabaseDriver, slugify, uniqueSlug } from './db.js';
import { DB_PATH, ROOT, UPLOAD_DIR } from './paths.js';
import { hashPassword } from './auth.js';
import { generateCoverSvg } from './covers.js';
import { buildKeywordIndex, makeExcerpt, readingMinutes, readEpub, saveKeywords } from './indexer.js';

const FONT_REGULAR = path.join(ROOT, 'server/assets/Sarabun-Regular.ttf');
const FONT_BOLD = path.join(ROOT, 'server/assets/Sarabun-Bold.ttf');

/* ------------------------------------------------------------------ data */

const USERS = [
  {
    name: 'ดร. ณัฐฐิญา วรรณศิลป์',
    email: 'admin@nakhonmaesot.app',
    password: 'Nakhonmaesot@2026',
    role: 'admin',
    affiliation: 'สำนักหอสมุดกลาง มหาวิทยาลัยศิลปากร',
    bio: 'ผู้ดูแลระบบและผู้อำนวยการฝ่ายทรัพยากรสารสนเทศ',
    hue: 168,
  },
  {
    name: 'ปวีณา สุขเจริญ',
    email: 'editor@nakhonmaesot.app',
    password: 'Nakhonmaesot@2026',
    role: 'editor',
    affiliation: 'กองบรรณาธิการวารสารมนุษยศาสตร์',
    bio: 'บรรณาธิการวารสารและผู้ประสานงานงานวิจัย',
    hue: 258,
  },
  {
    name: 'ธนกฤต ใจดี',
    email: 'reader@nakhonmaesot.app',
    password: 'Nakhonmaesot@2026',
    role: 'reader',
    affiliation: 'นักศึกษาระดับบัณฑิตศึกษา',
    bio: 'สนใจงานวิจัยด้านเมือง การออกแบบ และการศึกษา',
    hue: 22,
  },
  { name: 'สุชาดา พงษ์พันธ์', email: 'suchada@nakhonmaesot.app', password: 'Nakhonmaesot@2026', role: 'reader', affiliation: 'อาจารย์คณะครุศาสตร์', hue: 210 },
  { name: 'กิตติพงษ์ แก้วมณี', email: 'kittipong@nakhonmaesot.app', password: 'Nakhonmaesot@2026', role: 'reader', affiliation: 'นักวิจัยอิสระ', hue: 128 },
  { name: 'อรวรรณ ชัยวัฒน์', email: 'orawan@nakhonmaesot.app', password: 'Nakhonmaesot@2026', role: 'reader', affiliation: 'บรรณารักษ์', hue: 312 },
];

const CATEGORIES = [
  { slug: 'journals', name: 'วารสารวิชาการ', description: 'วารสารและบทความวิจัยที่ผ่านการกลั่นกรอง', accent: '#0f766e', icon: 'journal', sort: 1 },
  { slug: 'research', name: 'งานวิจัยและวิทยานิพนธ์', description: 'ผลงานวิจัยฉบับสมบูรณ์และรายงานการศึกษา', accent: '#4338ca', icon: 'flask', sort: 2 },
  { slug: 'ebooks', name: 'หนังสืออิเล็กทรอนิกส์', description: 'หนังสืออ่านเพิ่มเติมทั้งสารคดีและบันเทิงคดี', accent: '#be185d', icon: 'book', sort: 3 },
  { slug: 'magazines', name: 'นิตยสารและวัฒนธรรม', description: 'นิตยสาร บทความเชิงวัฒนธรรม และเรื่องเล่า', accent: '#b45309', icon: 'sparkle', sort: 4 },
  { slug: 'reports', name: 'รายงานประจำปี', description: 'รายงานผลการดำเนินงานและตัวชี้วัดองค์กร', accent: '#0369a1', icon: 'chart', sort: 5 },
  { slug: 'wellbeing', name: 'สุขภาพและชีวิตอยู่ดี', description: 'สุขภาวะกายใจ การนอน และการทำงานอย่างสมดุล', accent: '#047857', icon: 'heart', sort: 6 },
];

const PUBLICATIONS = [
  {
    slug: 'humanities-social-journal-vol12-no2',
    title: 'วารสารมนุษยศาสตร์และสังคมศาสตร์ ปีที่ 12 ฉบับที่ 2',
    subtitle: 'Reading Cultures in a Digital Age',
    type: 'journal',
    author: 'กองบรรณาธิการวารสารมนุษยศาสตร์',
    publisher: 'คณะมนุษยศาสตร์ มหาวิทยาลัยศิลปากร',
    year: 2567,
    issn: '2586-8414',
    category: 'journals',
    tags: ['มนุษยศาสตร์', 'สื่อดิจิทัล', 'วัฒนธรรมการอ่าน', 'สังคมศาสตร์'],
    description: 'รวมบทความวิจัยด้านมนุษยศาสตร์และสังคมศาสตร์ที่สำรวจวัฒนธรรมการอ่านในยุคดิจิทัล ตั้งแต่ห้องสมุดชุมชนไปจนถึงแพลตฟอร์มอ่านออนไลน์',
    abstract:
      'ฉบับนี้รวบรวมบทความจำนวนหกเรื่องที่ศึกษาการเปลี่ยนแปลงของวัฒนธรรมการอ่านในสังคมไทย ครอบคลุมประเด็นเรื่องห้องสมุดชุมชน แพลตฟอร์มดิจิทัล และพฤติกรรมของผู้อ่านรุ่นใหม่ พร้อมข้อเสนอเชิงนโยบายเพื่อลดช่องว่างการเข้าถึงความรู้',
    featured: 1,
    english: 'This issue explores shifting reading cultures across community libraries, digital platforms, and young adult readers in Thailand.',
  },
  {
    slug: 'applied-science-journal-vol8-no1',
    title: 'วารสารวิทยาศาสตร์และเทคโนโลยีประยุกต์ ปีที่ 8 ฉบับที่ 1',
    subtitle: 'Applied Data for Public Good',
    type: 'journal',
    author: 'ศูนย์วิจัยวิทยาศาสตร์ประยุกต์',
    publisher: 'สถาบันวิจัยและพัฒนา',
    year: 2567,
    issn: '2673-1120',
    category: 'journals',
    tags: ['วิทยาศาสตร์', 'เทคโนโลยี', 'ข้อมูลเปิด', 'นวัตกรรม'],
    description: 'บทความวิจัยด้านวิทยาศาสตร์ประยุกต์ การวิเคราะห์ข้อมูล และนวัตกรรมเพื่อสาธารณประโยชน์',
    abstract:
      'วารสารฉบับนี้เสนอผลงานวิจัยด้านวิทยาศาสตร์ประยุกต์จำนวนห้าเรื่อง เน้นการนำข้อมูลเปิดและแบบจำลองเชิงคำนวณมาใช้แก้ปัญหาชุมชน ตั้งแต่คุณภาพน้ำ การจัดการขยะ ไปจนถึงระบบเตือนภัยน้ำท่วม',
  },
  {
    slug: 'smart-search-digital-library',
    title: 'การออกแบบระบบสืบค้นอัจฉริยะสำหรับห้องสมุดดิจิทัล',
    subtitle: 'Designing Intelligent Discovery for Thai Digital Libraries',
    type: 'research',
    author: 'ณัฐฐิญา วรรณศิลป์, ปวีณา สุขเจริญ',
    publisher: 'สำนักพิมพ์มหาวิทยาลัยศิลปากร',
    year: 2567,
    isbn: '978-616-123-456-7',
    category: 'research',
    tags: ['ระบบสืบค้น', 'ห้องสมุดดิจิทัล', 'Thai NLP', 'UX Research'],
    description: 'งานวิจัยที่ออกแบบและพัฒนาระบบสืบค้นสำหรับคลังสารสนเทศไทย ด้วยการตัดคำภาษาไทย การจัดทำดัชนีคำสำคัญ และการจัดอันดับผลลัพธ์ตามความเกี่ยวข้อง',
    abstract:
      'การวิจัยนี้มีวัตถุประสงค์เพื่อออกแบบระบบสืบค้นอัจฉริยะสำหรับห้องสมุดดิจิทัลไทย โดยผสานการตัดคำภาษาไทย การจัดทำดัชนีคำสำคัญ และการจัดอันดับผลลัพธ์ ผลการทดลองพบว่าผู้ใช้สามารถเข้าถึงเอกสารที่ต้องการได้เร็วขึ้นร้อยละ 38 เมื่อเทียบกับระบบเดิม',
    featured: 1,
    english:
      'This study presents an intelligent discovery layer for Thai digital libraries, combining Thai word segmentation, keyword indexing and relevance ranking.',
  },
  {
    slug: 'walkable-city-public-space',
    title: 'เมืองที่เดินได้: การออกแบบพื้นที่สาธารณะเพื่อคุณภาพชีวิต',
    subtitle: 'Walkable City, Better Life',
    type: 'ebook',
    author: 'กิตติพงษ์ แก้วมณี',
    publisher: 'สำนักพิมพ์เมืองดี',
    year: 2566,
    isbn: '978-616-555-901-2',
    category: 'ebooks',
    tags: ['urban design', 'พื้นที่สาธารณะ', 'คุณภาพชีวิต', 'เมือง'],
    description: 'หนังสือที่ชวนสำรวจความสัมพันธ์ระหว่างการออกแบบเมืองกับชีวิตประจำวันของผู้คน พร้อมกรณีศึกษาจากเมืองไทยและต่างประเทศ',
    abstract:
      'หนังสือเล่มนี้ว่าด้วยการออกแบบพื้นที่สาธารณะที่เอื้อให้ผู้คนเดินได้ ใช้ชีวิตได้อย่างปลอดภัย และมีปฏิสัมพันธ์ต่อกัน ผู้เขียนผสานงานวิจัยด้านผังเมืองกับเรื่องเล่าจากพื้นที่จริง เพื่อเสนอแนวทางที่นำไปใช้ได้ในเมืองขนาดกลางของไทย',
    featured: 1,
  },
  {
    slug: 'voices-from-the-margin',
    title: 'เสียงจากชายขอบ: บันทึกวัฒนธรรมร่วมสมัย',
    subtitle: 'Essays on Contemporary Culture',
    type: 'magazine',
    author: 'อรวรรณ ชัยวัฒน์',
    publisher: 'นิตยสารลุ่มน้ำ',
    year: 2567,
    issn: '2730-7788',
    category: 'magazines',
    tags: ['วัฒนธรรม', 'สารคดี', 'ชาติพันธุ์', 'เรื่องเล่า'],
    description: 'รวมสารคดีและบทสัมภาษณ์ที่พาผู้อ่านไปรู้จักชุมชนชายขอบผ่านเสียงและเรื่องเล่าของผู้คน',
    abstract:
      'นิตยสารฉบับนี้ชวนอ่านสารคดีหกชิ้นที่บันทึกชีวิตและวัฒนธรรมของชุมชนชายขอบ ทั้งประเด็นภาษา แรงงานข้ามชาติ และศิลปะร่วมสมัย',
  },
  {
    slug: 'annual-report-2024-central-library',
    title: 'รายงานประจำปี 2567 สำนักหอสมุดกลาง',
    subtitle: 'Annual Report 2024',
    type: 'report',
    author: 'สำนักหอสมุดกลาง',
    publisher: 'มหาวิทยาลัยศิลปากร',
    year: 2567,
    isbn: '978-616-000-778-1',
    category: 'reports',
    tags: ['รายงานประจำปี', 'หอสมุด', 'ตัวชี้วัด', 'บริการสารสนเทศ'],
    description: 'สรุปผลการดำเนินงานของสำนักหอสมุดกลาง ประจำปีงบประมาณ 2567 พร้อมตัวชี้วัดสำคัญและแผนงานปีถัดไป',
    abstract:
      'รายงานฉบับนี้นำเสนอผลการดำเนินงานประจำปี 2567 ของสำนักหอสมุดกลาง ครอบคลุมจำนวนผู้ใช้บริการ การพัฒนาทรัพยากรสารสนเทศดิจิทัล ผลการดำเนินโครงการส่งเสริมการอ่าน และตัวชี้วัดความพึงพอใจของผู้ใช้บริการ',
  },
  {
    slug: 'digital-mind-wellbeing',
    title: 'สุขภาพใจในยุคดิจิทัล: อยู่กับจออย่างไรให้ใจเป็นสุข',
    subtitle: 'Digital Wellbeing Handbook',
    type: 'ebook',
    author: 'สุชาดา พงษ์พันธ์',
    publisher: 'สำนักพิมพ์ใจดี',
    year: 2566,
    isbn: '978-616-888-334-5',
    category: 'wellbeing',
    tags: ['สุขภาวะ', 'สุขภาพใจ', 'ดิจิทัล detox', 'การนอน'],
    description: 'คู่มือทำความเข้าใจความสัมพันธ์ระหว่างเทคโนโลยีกับสุขภาพใจ พร้อมแบบฝึกหัดที่ทำตามได้จริงในชีวิตประจำวัน',
    abstract:
      'หนังสือเล่มนี้สำรวจผลของเทคโนโลยีดิจิทัลต่อสุขภาพใจ ทั้งการนอนหลับ สมาธิ และความสัมพันธ์ระหว่างบุคคล พร้อมเสนอแนวปฏิบัติที่เริ่มได้ทันที',
  },
  {
    slug: 'flipbook-library-services',
    title: 'พลิกหน้าเรียนรู้: แนะนำบริการหอสมุด',
    subtitle: 'Library Services Flipbook',
    type: 'flipbook',
    author: 'ฝ่ายบริการสารสนเทศ',
    publisher: 'สำนักหอสมุดกลาง',
    year: 2567,
    category: 'reports',
    tags: ['หอสมุด', 'บริการ', 'flipbook', 'คู่มือ'],
    description: 'คู่มือบริการหอสมุดฉบับพลิกหน้า อ่านง่ายด้วยภาพประกอบ เหมาะสำหรับนักศึกษาใหม่และผู้ใช้บริการทั่วไป',
    abstract:
      'คู่มือแนะนำบริการของหอสมุดกลาง ตั้งแต่การยืมคืน การใช้ฐานข้อมูลออนไลน์ ไปจนถึงพื้นที่เรียนรู้ร่วมกัน',
    flipMode: true,
  },
  {
    slug: 'reading-lifelong-learning',
    title: 'การอ่านกับการเรียนรู้ตลอดชีวิต',
    subtitle: 'Reading for Lifelong Learning',
    type: 'journal',
    author: 'สุชาดา พงษ์พันธ์',
    publisher: 'สมาคมห้องสมุดแห่งประเทศไทย',
    year: 2566,
    issn: '2408-2350',
    category: 'journals',
    tags: ['การเรียนรู้ตลอดชีวิต', 'การอ่าน', 'การศึกษา', 'ห้องสมุด'],
    description: 'บทความวิชาการว่าด้วยบทบาทของการอ่านต่อการเรียนรู้ตลอดชีวิต และแนวทางส่งเสริมนิสัยรักการอ่านในชุมชน',
    abstract:
      'บทความนี้ทบทวนงานวิจัยเกี่ยวกับพฤติกรรมการอ่านของคนไทย และเสนอรูปแบบการส่งเสริมการเรียนรู้ตลอดชีวิตที่เชื่อมโยงระหว่างห้องสมุด โรงเรียน และครอบครัว',
  },
  {
    slug: 'thai-language-teaching-21st-century',
    title: 'นวัตกรรมการสอนภาษาไทยในศตวรรษที่ 21',
    subtitle: 'Innovative Thai Language Pedagogy',
    type: 'research',
    author: 'อรวรรณ ชัยวัฒน์, ปวีณา สุขเจริญ',
    publisher: 'คณะศึกษาศาสตร์',
    year: 2568,
    isbn: '978-616-777-210-4',
    category: 'research',
    tags: ['การสอน', 'ภาษาไทย', 'นวัตกรรม', 'หลักสูตร'],
    description: 'งานวิจัยเชิงปฏิบัติการที่ทดลองใช้กิจกรรมการเรียนรู้แบบมีส่วนร่วมเพื่อพัฒนาทักษะภาษาไทยของผู้เรียน',
    abstract:
      'การวิจัยนี้พัฒนาชุดกิจกรรมการสอนภาษาไทยที่ผสานสื่อดิจิทัลและกระบวนการสะท้อนคิด เพื่อยกระดับทักษะการอ่านเชิงวิเคราะห์ของผู้เรียนระดับมัธยมศึกษา',
    featured: 1,
  },
  {
    slug: 'stories-from-the-library-25-years',
    title: 'เรื่องเล่าจากห้องสมุด: 25 ปีแห่งการเรียนรู้',
    subtitle: '25 Years of Stories',
    type: 'ebook',
    author: 'ฝ่ายวารสารและสารสนเทศ',
    publisher: 'สำนักหอสมุดกลาง',
    year: 2565,
    isbn: '978-616-321-008-9',
    category: 'ebooks',
    tags: ['ประวัติศาสตร์', 'ห้องสมุด', 'เรื่องเล่า', 'สถาบัน'],
    description: 'หนังสือที่รวบรวมความทรงจำและเรื่องเล่าจากผู้ใช้งานหอสมุดตลอด 25 ปี',
    abstract:
      'หนังสือเล่มนี้บอกเล่าประวัติศาสตร์ของหอสมุดผ่านเสียงของผู้คน ตั้งแต่บรรณารักษ์รุ่นแรก นักศึกษา ไปจนถึงนักวิจัยที่ใช้บริการมานานกว่าสองทศวรรษ',
  },
  {
    slug: 'national-reading-index-2024',
    title: 'รายงานดัชนีการอ่านแห่งชาติ 2567',
    subtitle: 'National Reading Index Report',
    type: 'report',
    author: 'คณะกรรมการส่งเสริมการอ่าน',
    publisher: 'สำนักงานวัฒนธรรมและการเรียนรู้',
    year: 2567,
    issn: '2774-0452',
    category: 'reports',
    tags: ['การอ่าน', 'ดัชนี', 'สถิติ', 'นโยบาย'],
    description: 'รายงานสำรวจพฤติกรรมการอ่านของคนไทยทั้งประเทศ พร้อมดัชนีชี้วัดและข้อเสนอเชิงนโยบาย',
    abstract:
      'รายงานฉบับนี้ประมวลผลการสำรวจพฤติกรรมการอ่านของประชากรไทยกว่า 12,000 ครัวเรือน ครอบคลุมเวลาในการอ่าน ประเภทสื่อ และปัจจัยที่ส่งผลต่อนิสัยการอ่าน',
  },
  {
    slug: 'draft-curating-local-archives',
    title: 'การจัดการจดหมายเหตุท้องถิ่น (ฉบับร่าง)',
    subtitle: 'Curating Local Archives',
    type: 'research',
    author: 'ธนกฤต ใจดี',
    publisher: 'สำนักหอสมุดกลาง',
    year: 2568,
    category: 'research',
    tags: ['จดหมายเหตุ', 'ท้องถิ่น', 'การอนุรักษ์'],
    description: 'ร่างงานวิจัยว่าด้วยการจัดการจดหมายเหตุท้องถิ่นด้วยเครื่องมือดิจิทัล (อยู่ระหว่างการตรวจแก้)',
    abstract: 'งานวิจัยนี้ศึกษากระบวนการรวบรวม จัดระบบ และเผยแพร่จดหมายเหตุท้องถิ่นด้วยเครื่องมือดิจิทัล',
    status: 'draft',
  },
  {
    slug: 'draft-library-space-redesign',
    title: 'พื้นที่เรียนรู้ที่ออกแบบร่วม (ฉบับร่าง)',
    subtitle: 'Co-designed Learning Spaces',
    type: 'ebook',
    author: 'ปวีณา สุขเจริญ',
    publisher: 'สำนักหอสมุดกลาง',
    year: 2568,
    category: 'ebooks',
    tags: ['พื้นที่เรียนรู้', 'co-design', 'หอสมุด'],
    description: 'ร่างหนังสือว่าด้วยการออกแบบพื้นที่เรียนรู้ร่วมกับผู้ใช้บริการ (อยู่ระหว่างเขียนบทที่ 3)',
    abstract: 'หนังสือเล่มนี้รวบรวมกระบวนการออกแบบพื้นที่เรียนรู้ร่วมกับผู้ใช้บริการในมหาวิทยาลัย',
    status: 'draft',
  },
];

const TYPE_SECTIONS = {
  journal: ['บทคัดย่อ', 'บทนำ', 'วรรณกรรมที่เกี่ยวข้อง', 'วิธีดำเนินการวิจัย', 'ผลการวิจัย', 'อภิปรายผล', 'ข้อเสนอแนะ'],
  research: ['บทคัดย่อ', 'ความเป็นมาและความสำคัญ', 'วัตถุประสงค์ของงานวิจัย', 'ระเบียบวิธีวิจัย', 'ผลการวิเคราะห์ข้อมูล', 'อภิปรายผลและข้อเสนอแนะ'],
  ebook: ['คำนำ', 'บทที่ 1 เริ่มต้นจากคำถาม', 'บทที่ 2 มองเมืองด้วยสายตาผู้อ่าน', 'บทที่ 3 ปฏิบัติการในชีวิตประจำวัน', 'บทที่ 4 บทส่งท้ายและก้าวต่อไป'],
  magazine: ['จากบรรณาธิการ', 'เรื่องเด่น', 'สารคดี: เสียงที่ไม่ได้ยิน', 'บทสัมภาษณ์', 'คอลัมน์วัฒนธรรม'],
  report: ['บทสรุปผู้บริหาร', 'ภาพรวมการดำเนินงาน', 'ผลลัพธ์สำคัญและตัวชี้วัด', 'บทเรียนที่ได้เรียนรู้', 'ข้อเสนอแนะและแผนงานปีถัดไป'],
  flipbook: ['ยินดีต้อนรับสู่หอสมุด', 'บริการยืม–คืนและทรัพยากร', 'ฐานข้อมูลและบริการออนไลน์', 'พื้นที่เรียนรู้และกิจกรรม', 'ติดต่อและช่วยเหลือ'],
};

const PARAGRAPHS = [
  'การเปลี่ยนแปลงของเทคโนโลยีดิจิทัลได้ปรับโฉมวิธีที่ผู้คนเข้าถึงองค์ความรู้อย่างมีนัยสำคัญ ห้องสมุดจึงต้องพัฒนาเครื่องมือค้นหาและช่องทางการอ่านที่ตอบโจทย์ผู้ใช้ที่คุ้นเคยกับการค้นหาผ่านโทรศัพท์มือถือมากขึ้น',
  'ผลการศึกษาแสดงให้เห็นว่า ผู้ใช้ให้ความสำคัญกับความรวดเร็วในการเข้าถึงเนื้อหา ความชัดเจนของข้อมูลบรรณานุกรม และความสามารถในการอ่านต่อจากอุปกรณ์เครื่องเดิม การออกแบบประสบการณ์อ่านที่ต่อเนื่องจึงเป็นปัจจัยสำคัญ',
  'คณะผู้วิจัยเก็บรวบรวมข้อมูลด้วยการสัมภาษณ์เชิงลึก การสำรวจออนไลน์ และการวิเคราะห์บันทึกการใช้งานระบบ จากนั้นนำผลมาพัฒนาต้นแบบและทดสอบกับกลุ่มผู้ใช้จริงจำนวนสามรอบ',
  'ข้อค้นพบหลักชี้ว่า การจัดหมวดหมู่ที่ชัดเจนและคำสำคัญที่ตรงกับภาษาของผู้ใช้ช่วยลดเวลาค้นหาได้อย่างมีนัยสำคัญ ขณะที่คำอธิบายย่อที่มีคุณภาพช่วยให้ผู้ใช้ตัดสินใจเลือกเอกสารได้แม่นยำขึ้น',
  'ข้อเสนอแนะเชิงนโยบายประกอบด้วยสามประเด็น ได้แก่ การลงทุนในโครงสร้างพื้นฐานดิจิทัลที่เปิดกว้าง การพัฒนาบุคลากรให้มีทักษะด้านข้อมูล และการสร้างกลไกวัดผลที่เชื่อมโยงกับคุณภาพการเรียนรู้ของผู้ใช้',
  'งานศึกษานี้ยังมีข้อจำกัดด้านขนาดกลุ่มตัวอย่างและช่วงเวลาการเก็บข้อมูล จึงควรมีการศึกษาต่อในระยะยาว เพื่อติดตามการเปลี่ยนแปลงพฤติกรรมของผู้ใช้เมื่อเทคโนโลยีใหม่เข้าสู่ชีวิตประจำวัน',
  'ผู้เขียนหวังว่าข้อค้นพบเหล่านี้จะเป็นประโยชน์ต่อผู้บริหารสถานศึกษา บรรณารักษ์ และนักออกแบบบริการ ที่ต้องการยกระดับการเข้าถึงสารสนเทศให้เท่าเทียมและยั่งยืน',
];

const CITE = 'เอกสารอ้างอิง: สำนักหอสมุดกลาง (2567). แนวปฏิบัติด้านการจัดการสารสนเทศดิจิทัล. กรุงเทพฯ: สำนักพิมพ์มหาวิทยาลัย.';

function contentSections(pub) {
  const headings = TYPE_SECTIONS[pub.type] ?? TYPE_SECTIONS.ebook;
  const seed = pub.slug.length + pub.title.length;
  return headings.map((heading, index) => {
    const paragraphs =
      index === 0
        ? [pub.abstract, PARAGRAPHS[seed % PARAGRAPHS.length]]
        : [
            PARAGRAPHS[(seed + index * 2) % PARAGRAPHS.length],
            PARAGRAPHS[(seed + index * 2 + 3) % PARAGRAPHS.length],
          ];
    if (index === headings.length - 1 && pub.type !== 'flipbook') paragraphs.push(CITE);
    return { heading, paragraphs };
  });
}

/* --------------------------------------------------------------- helpers */

let rngState = 20241020;
function random() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const randomInt = (min, max) => Math.floor(random() * (max - min + 1)) + min;

const PAGE_W = 420;
const PAGE_H = 595;
const MARGIN = 44;

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}

function wrapLines(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      const test = line + char;
      const isMark = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(char);
      if (!isMark && line && font.widthOfTextAtSize(test, size) > maxWidth) {
        lines.push(line.trimEnd());
        line = char;
      } else {
        line = test;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

async function makePdf(pub, sections, accent, outPath) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fs.readFileSync(FONT_REGULAR), { subset: true });
  const bold = await doc.embedFont(fs.readFileSync(FONT_BOLD), { subset: true });
  doc.setTitle(pub.title);
  doc.setAuthor(pub.author);
  doc.setSubject(pub.description ?? '');

  const dark = rgb(0.07, 0.1, 0.14);
  const muted = rgb(0.42, 0.47, 0.52);
  const tint = hexToRgb(accent);

  const cover = doc.addPage([PAGE_W, PAGE_H]);
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: hexToRgb(accent) });
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: dark, opacity: 0.55 });
  cover.drawRectangle({ x: 36, y: PAGE_H - 12, width: PAGE_W - 72, height: 3, color: rgb(1, 1, 1), opacity: 0.35 });
  const typeLabel = { journal: 'JOURNAL', ebook: 'E-BOOK', flipbook: 'FLIPBOOK', report: 'REPORT', magazine: 'MAGAZINE' }[pub.type];
  cover.drawText(String(typeLabel), { x: 40, y: PAGE_H - 58, size: 9, font: bold, color: rgb(1, 1, 1), opacity: 0.85 });
  const titleLines = wrapLines(pub.title, bold, 26, PAGE_W - 88).slice(0, 6);
  let y = PAGE_H - 140;
  for (const line of titleLines) {
    cover.drawText(line, { x: 40, y, size: 26, font: bold, color: rgb(1, 1, 1) });
    y -= 34;
  }
  if (pub.subtitle) {
    y -= 6;
    cover.drawText(pub.subtitle.slice(0, 60), { x: 40, y, size: 11, font: regular, color: rgb(1, 1, 1), opacity: 0.75 });
  }
  cover.drawRectangle({ x: 40, y: 128, width: 60, height: 2, color: tint });
  cover.drawText(String(pub.author).slice(0, 52), { x: 40, y: 98, size: 13, font: bold, color: rgb(1, 1, 1), opacity: 0.92 });
  cover.drawText(`${pub.publisher} · พ.ศ. ${pub.year}`, { x: 40, y: 78, size: 9, font: regular, color: rgb(1, 1, 1), opacity: 0.7 });
  cover.drawText('NAKHONMAESOT LIBRARY', { x: 40, y: 38, size: 8, font: bold, color: rgb(1, 1, 1), opacity: 0.55 });

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let cursor = PAGE_H - 96;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    cursor = PAGE_H - 96;
  };
  const drawHeader = () => {
    page.drawText(String(pub.title).slice(0, 48), { x: MARGIN, y: PAGE_H - 44, size: 7.5, font: regular, color: muted });
    page.drawLine({
      start: { x: MARGIN, y: PAGE_H - 54 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 54 },
      thickness: 0.6,
      color: rgb(0.86, 0.88, 0.9),
    });
  };
  drawHeader();

  const writeBlock = (text, size, font, lineGap = 5, color = dark) => {
    const lines = wrapLines(text, font, size, PAGE_W - MARGIN * 2);
    for (const line of lines) {
      if (cursor < MARGIN + 30) {
        newPage();
        drawHeader();
      }
      page.drawText(line, { x: MARGIN, y: cursor, size, font, color });
      cursor -= size + lineGap;
    }
  };

  for (const section of sections) {
    if (cursor < PAGE_H - 200) {
      newPage();
      drawHeader();
    }
    cursor -= 8;
    page.drawRectangle({ x: MARGIN, y: cursor + 16, width: 22, height: 2, color: tint });
    writeBlock(section.heading, 15, bold, 10);
    cursor -= 4;
    for (const paragraph of section.paragraphs) {
      writeBlock(paragraph, 10.5, regular, 6.2);
      cursor -= 5;
    }
    cursor -= 10;
  }

  const pages = doc.getPages();
  pages.slice(1).forEach((current, index) => {
    current.drawText('NAKHONMAESOT LIBRARY', { x: MARGIN, y: 24, size: 6.5, font: regular, color: muted });
    current.drawText(`${index + 2} / ${pages.length}`, { x: PAGE_W - MARGIN - 34, y: 24, size: 7, font: regular, color: muted });
  });

  const bytes = await doc.save();
  fs.writeFileSync(outPath, bytes);
  return pages.length;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeEpub(pub, sections, outPath) {
  const chapters = sections.map((section, index) => ({
    id: `ch${index + 1}`,
    file: `ch${index + 1}.xhtml`,
    title: section.heading,
    html: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="th"><head><title>${escapeHtml(section.heading)}</title>
<link rel="stylesheet" href="style.css" /></head><body>
<h1>${escapeHtml(section.heading)}</h1>
${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}
<hr />
<p class="cite">© พ.ศ. ${pub.year} ${escapeHtml(pub.publisher)}</p>
</body></html>`,
  }));

  const manifest = chapters
    .map((chapter) => `<item id="${chapter.id}" href="${chapter.file}" media-type="application/xhtml+xml" />`)
    .join('\n    ');
  const spine = chapters.map((chapter) => `<itemref idref="${chapter.id}" />`).join('\n    ');
  const nav = chapters.map((chapter) => `<li><a href="${chapter.file}">${escapeHtml(chapter.title)}</a></li>`).join('\n      ');

  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="th">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:isbn:${pub.isbn ?? '978-616-321-008-9'}</dc:identifier>
    <dc:title>${escapeHtml(pub.title)}</dc:title>
    <dc:creator>${escapeHtml(pub.author)}</dc:creator>
    <dc:language>th</dc:language>
    <dc:publisher>${escapeHtml(pub.publisher)}</dc:publisher>
    <meta property="dcterms:modified">2024-12-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="css" href="style.css" media-type="text/css" />
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="th">
<head><title>สารบัญ</title></head><body>
<nav epub:type="toc" id="toc"><h1>สารบัญ</h1><ol>
      ${nav}
</ol></nav></body></html>`),
    'OEBPS/style.css': strToU8('body{font-family:serif;line-height:1.7;margin:6%;}h1{font-size:1.4em;}p{text-indent:1.5em;margin:0 0 .8em;}'),
  };
  for (const chapter of chapters) files[`OEBPS/${chapter.file}`] = strToU8(chapter.html);
  fs.writeFileSync(outPath, zipSync(files));
}

/* ------------------------------------------------------------------ seed */

export async function seedDatabase() {
  if (process.argv.includes('--force')) {
    for (const table of [
      'reading_progress',
      'bookmarks',
      'analytics_events',
      'keywords',
      'publication_tags',
      'publications',
      'tags',
      'categories',
      'sessions',
      'users',
    ]) {
      await db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  const userIds = {};
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, affiliation, bio, avatar_hue, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  );
  for (const [index, user] of USERS.entries()) {
    const createdAt = new Date(Date.now() - (120 - index * 12) * 86400_000).toISOString();
    const info = await insertUser.run(
      user.name,
      user.email,
      hashPassword(user.password),
      user.role,
      user.affiliation,
      user.bio ?? null,
      user.hue,
      createdAt,
    );
    userIds[user.email] = Number(info.lastInsertRowid);
  }

  const categoryIds = {};
  const insertCategory = db.prepare(
    'INSERT INTO categories (slug, name, description, accent, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const category of CATEGORIES) {
    const info = await insertCategory.run(
      category.slug,
      category.name,
      category.description,
      category.accent,
      category.icon,
      category.sort,
    );
    categoryIds[category.slug] = Number(info.lastInsertRowid);
  }

  const insertPublication = db.prepare(
    `INSERT INTO publications (slug, title, subtitle, type, description, abstract, author, publisher, year, issn, isbn,
       language, pages, category_id, status, featured, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'th', 0, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const linkTag = db.prepare('INSERT OR IGNORE INTO publication_tags (publication_id, tag_id) VALUES (?, ?)');

  const published = [];
  let order = 0;
  for (const pub of PUBLICATIONS) {
    const sections = contentSections(pub);
    const status = pub.status ?? 'published';
    const createdAt = new Date(Date.now() - (90 - order * 5) * 86400_000).toISOString();
    const info = await insertPublication.run(
      pub.slug,
      pub.title,
      pub.subtitle ?? null,
      pub.type,
      pub.description ?? null,
      pub.abstract ?? null,
      pub.author,
      pub.publisher,
      pub.year,
      pub.issn ?? null,
      pub.isbn ?? null,
      categoryIds[pub.category],
      status,
      pub.featured ?? 0,
      userIds[status === 'draft' ? (order % 2 === 0 ? 'reader@nakhonmaesot.app' : 'editor@nakhonmaesot.app') : 'editor@nakhonmaesot.app'],
      createdAt,
      createdAt,
    );
    const id = Number(info.lastInsertRowid);
    const dir = path.join(UPLOAD_DIR, 'books', String(id));
    fs.mkdirSync(dir, { recursive: true });

    const category = CATEGORIES.find((cat) => cat.slug === pub.category);
    const coverSvg = generateCoverSvg({
      title: pub.title,
      author: pub.author,
      type: pub.type,
      category: category?.name ?? '',
      id,
    });
    const coverDir = path.join(UPLOAD_DIR, 'covers');
    fs.mkdirSync(coverDir, { recursive: true });
    fs.writeFileSync(path.join(coverDir, `seed-${id}.svg`), coverSvg);

    let fileType = 'pdf';
    let pages = 0;
    let text = '';
    if (pub.slug === 'stories-from-the-library-25-years') {
      fileType = 'epub';
      makeEpub(pub, sections, path.join(dir, 'book.epub'));
      const epub = readEpub(fs.readFileSync(path.join(dir, 'book.epub')), {
        publicBase: `/uploads/books/${id}/epub`,
      });
      for (const [assetName, assetBytes] of epub.assets) {
        const target = path.join(dir, 'epub', assetName);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, assetBytes);
      }
      fs.writeFileSync(path.join(dir, 'chapters.json'), JSON.stringify({ title: epub.title, chapters: epub.chapters }));
      pages = epub.pageCount;
      text = epub.text;
    } else {
      pages = await makePdf(pub, sections, category?.accent ?? '#334155', path.join(dir, 'book.pdf'));
      text = [
        pub.title,
        pub.abstract,
        ...sections.flatMap((section) => [section.heading, ...section.paragraphs]),
        pub.english ?? '',
      ].join('\n');
    }
    const size = fs.statSync(path.join(dir, fileType === 'epub' ? 'book.epub' : 'book.pdf')).size;
    const type = pub.flipMode ? 'flipbook' : pub.type;

    await db.prepare(
      `UPDATE publications SET cover_url = ?, file_url = ?, file_type = ?, file_size = ?, pages = ?, type = ? WHERE id = ?`,
    ).run(
      `/uploads/covers/seed-${id}.svg`,
      `/uploads/books/${id}/${fileType === 'epub' ? 'book.epub' : 'book.pdf'}`,
      fileType,
      size,
      pages,
      type,
      id,
    );

    for (const tag of pub.tags ?? []) {
      await insertTag.run(tag, await uniqueSlug('tags', tag));
      const tagRow = await findTag.get(tag);
      if (tagRow) await linkTag.run(id, tagRow.id);
    }

    const metadata = [pub.title, pub.subtitle, pub.author, pub.publisher, pub.description, pub.abstract, pub.issn, pub.isbn, pub.year]
      .filter(Boolean)
      .join('\n');
    const fullText = `${metadata}\n\n${text}`;
    const keywords = buildKeywordIndex(fullText, { title: pub.title, author: pub.author });
    await saveKeywords(id, keywords);
    await db.prepare(
      `UPDATE publications SET content_text = ?, excerpt = ?, top_keywords = ?, reading_minutes = ? WHERE id = ?`,
    ).run(
      fullText.slice(0, 160_000),
      makeExcerpt(pub.abstract ?? pub.description ?? ''),
      JSON.stringify(keywords.slice(0, 14).map(({ term, count }) => ({ term, count }))),
      readingMinutes(fullText),
      id,
    );

    if (status === 'published') published.push({ id, pub, pages });
    order += 1;
  }

  // Analytics history for the past 45 days.
  const insertEvent = db.prepare(
    'INSERT INTO analytics_events (publication_id, user_id, type, day, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const readers = USERS.filter((user) => user.role === 'reader').map((user) => userIds[user.email]);
  const counters = new Map(published.map((entry) => [entry.id, { views: 0, reads: 0, downloads: 0 }]));

  // Awaited: cloud drivers (libSQL/Turso) open the transaction asynchronously,
  // so firing BEGIN without waiting would let inserts run outside it.
  await db.exec('BEGIN');
  try {
    for (let offset = 44; offset >= 0; offset -= 1) {
      const day = new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
      for (const entry of published) {
        const popularity = 3 + (entry.pub.featured ? 4 : 0) + (entry.id % 5);
        const views = randomInt(0, popularity);
        const reads = randomInt(0, Math.ceil(popularity / 2));
        const downloads = randomInt(0, Math.ceil(popularity / 3));
        const complete = random() > 0.75 ? 1 : 0;
        const push = async (type, count) => {
          for (let i = 0; i < count; i += 1) {
            const time = new Date(Date.now() - offset * 86400_000 + randomInt(0, 20) * 3600_000).toISOString();
            await insertEvent.run(entry.id, readers[randomInt(0, readers.length - 1)] ?? null, type, day, time);
          }
          if (counters.has(entry.id)) {
            const key = type === 'view' ? 'views' : type === 'read' ? 'reads' : type === 'download' ? 'downloads' : null;
            if (key) counters.get(entry.id)[key] += count;
          }
        };
        await push('view', views);
        await push('read', reads);
        await push('download', downloads);
        if (complete) await push('complete', 1);
      }
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  for (const [id, counts] of counters) {
    await db.prepare('UPDATE publications SET views = ?, reads = ?, downloads = ? WHERE id = ?').run(
      counts.views,
      counts.reads,
      counts.downloads,
      id,
    );
  }

  const readerId = userIds['reader@nakhonmaesot.app'];
  const progressEntries = published.slice(0, 5);
  for (const [index, entry] of progressEntries.entries()) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO reading_progress (user_id, publication_id, progress, page, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(readerId, entry.id, [0.42, 0.18, 0.76, 0.05, 0.93][index] ?? 0.2, [4, 2, 6, 1, 8][index] ?? 1, nowIso());
  }
  for (const entry of [published[2], published[6]].filter(Boolean)) {
    await db
      .prepare('INSERT OR IGNORE INTO bookmarks (user_id, publication_id, created_at) VALUES (?, ?, ?)')
      .run(readerId, entry.id, nowIso());
  }

  console.log(
    `[nakhonmaesot] seeded ${USERS.length} users, ${CATEGORIES.length} categories, ${PUBLICATIONS.length} publications`,
  );
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  const [{ createSqliteDriver }, { createFsStorage }, { setStorageDriver }] = await Promise.all([
    import('./drivers/sqlite.js'),
    import('./drivers/fs-storage.js'),
    import('./storage.js'),
  ]);
  setDatabaseDriver(createSqliteDriver(DB_PATH));
  setStorageDriver(createFsStorage(UPLOAD_DIR));

  const exists = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
  if (exists && !process.argv.includes('--force')) {
    console.log('[nakhonmaesot] database already seeded — use --force to reset');
  } else {
    if (process.argv.includes('--force')) {
      fs.rmSync(path.join(UPLOAD_DIR, 'books'), { recursive: true, force: true });
      fs.rmSync(path.join(UPLOAD_DIR, 'covers'), { recursive: true, force: true });
    }
    await seedDatabase();
  }
}
