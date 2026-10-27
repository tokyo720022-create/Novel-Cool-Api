import cheerio from 'cheerio';
import axios from 'axios';
import { getCategoryList, filterCategoryList } from './modules/categoryList.js';
import { pagination } from './modules/pagination.js';
import { getMangas } from './modules/getMangas.js';
import { upstream } from './modules/limiter.js';

const axiosHead = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  timeout: 25000,
  maxRedirects: 5,
};

// The scraper targets the English NovelCool site only.
const BASE_URL = 'https://en.novelcool.com/';
const mainUrl = () => BASE_URL;

// Chapter links on the site point at www.novelcool.com.
const CHAPTER_BASE_URL = 'https://www.novelcool.com/';

// "Ongoing" / "Completed" appear in the same list as genres on NovelCool.
const STATUS_LABELS = new Set(['ongoing', 'completed']);

const PLACEHOLDER_RE =
  /^(?:n\s*\/?\s*a|none|null|undefined|unknown|not\s+available|loading|-)$/i;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isPlaceholder(value) {
  const cleaned = cleanText(value);

  if (!cleaned || PLACEHOLDER_RE.test(cleaned)) {
    return true;
  }

  return /^(?:n\s*\/\s*a){2,}$/i.test(
    cleaned.replace(/\s+/g, ''),
  );
}

function deduplicateSentenceText(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return '';

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter(Boolean);

  if (sentences.length < 2) return cleaned;

  const seen = new Set();
  const unique = [];

  for (const sentence of sentences) {
    const key = sentence.toLocaleLowerCase('en');

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sentence);
    }
  }

  return cleanText(unique.join(' '));
}

// Every request to NovelCool goes through a small concurrency limit.
async function AxiosGet(url) {
  return upstream(() => axios.get(url, axiosHead));
}

// `root` is either the Cheerio `$` function (search the whole page) or a
// Cheerio node (search inside that node only).
function firstText(root, selectors, { minLength = 1 } = {}) {
  const find =
    typeof root === 'function'
      ? (selector) => root(selector)
      : (selector) => root.find(selector);

  for (const selector of selectors) {
    const found = find(selector);

    for (let index = 0; index < found.length; index += 1) {
      const candidate = cleanText(found.eq(index).text());

      if (
        !isPlaceholder(candidate) &&
        candidate.length >= minLength
      ) {
        return candidate;
      }
    }
  }

  return '';
}

function firstAttribute($, selectors, attributes) {
  for (const selector of selectors) {
    let value = '';

    $(selector).each((_, element) => {
      if (value) return;

      for (const attribute of attributes) {
        const candidate = cleanText($(element).attr(attribute));

        if (
          candidate &&
          !candidate.startsWith('data:image/')
        ) {
          value = candidate;
          break;
        }
      }
    });

    if (value) return value;
  }

  return '';
}

function absoluteUrl(value, base = mainUrl()) {
  const raw = cleanText(value);

  if (
    !raw ||
    raw.startsWith('data:') ||
    raw.startsWith('javascript:')
  ) {
    return '';
  }

  try {
    const result = new URL(raw, base);

    return ['http:', 'https:'].includes(result.protocol)
      ? result.href
      : '';
  } catch {
    return '';
  }
}

function getDescription($) {
  const selectors = [
    '.bk-summary .bk-summary-txt',
    '.bookinfo-summary',
    '.bookinfo-desc',
    '.bookinfo-description',
    '.book-description',
    '.book-desc',
    '.bookinfo-intro',
    '.book-intro',
    '.book-summary-content',
    '.book-summary',
    '[itemprop="description"]',
  ];

  const candidates = [];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const candidate = deduplicateSentenceText(
        $(element).text(),
      );

      if (
        candidate.length >= 20 &&
        !isPlaceholder(candidate)
      ) {
        candidates.push(candidate);
      }
    });
  }

  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:description"]',
  ]) {
    const candidate = deduplicateSentenceText(
      $(selector).attr('content'),
    );

    if (
      candidate.length >= 20 &&
      !isPlaceholder(candidate)
    ) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.length - a.length);

  return candidates[0] ?? '';
}

function getStatus($) {
  return firstText($, [
    '.bk-cates .bookinfo-category-list > .bk-cate-type1',
    '.bk-status .bk-status-item',
  ]);
}

function getGenres($) {
  const selectors = [
    '.bk-cates .bookinfo-category-list > .bk-cate-item:not(.bk-cate-type1)',
    '.bookinfo-category-list a',
    '.book-tags .book-tag',
  ];

  for (const selector of selectors) {
    const found = [];

    $(selector).each((_, element) => {
      const text =
        cleanText($(element).find('a span').first().text()) ||
        cleanText($(element).text());

      if (
        text &&
        !isPlaceholder(text) &&
        !STATUS_LABELS.has(text.toLowerCase()) &&
        !found.includes(text)
      ) {
        found.push(text);
      }
    });

    if (found.length) return found;
  }

  return [];
}

function chapterIdFromHref(href) {
  const raw = cleanText(href);
  if (!raw) return '';

  let pathname;

  try {
    pathname = new URL(raw, mainUrl()).pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0];
  }

  const markerIndex = pathname.toLowerCase().indexOf('/chapter/');

  if (markerIndex >= 0) {
    pathname = pathname.slice(
      markerIndex + '/chapter/'.length,
    );
  } else {
    const match = pathname.match(/chapter\/(.+)$/i);

    if (!match) return '';

    pathname = match[1];
  }

  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the path if its percent-encoding is malformed.
  }

  return pathname
    .replace(/-\d+-\d+\.html?$/i, '')
    .replace(/\.html?$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function extractChapterEntries($) {
  const selectors = [
    '.chapter-item-list .chp-inner-ls > .chp-item',
    '.chapter-item-list .chp-item',
    '.chapter-list .chapter-item',
    '.chapter-list li',
    '.chapters-list .chapter-item',
    '.chapter-list-item',
    'a[href*="/chapter/"]',
  ];

  for (const selector of selectors) {
    const entries = [];
    const seen = new Set();

    $(selector).each((_, element) => {
      const node = $(element);

      const anchor = node.is('a')
        ? node
        : node.find('a[href]').first();

      const href = cleanText(anchor.attr('href'));

      if (!href || !href.toLowerCase().includes('/chapter/')) {
        return;
      }

      const chapterId = chapterIdFromHref(href);

      if (!chapterId || seen.has(chapterId)) return;

      seen.add(chapterId);

      let chapterTitle = '';

      for (const titleSelector of [
        '.chapter-item-title .chapter-item-headtitle',
        '.chapter-item-headtitle',
        '.chapter-title',
        '.chapter-name',
        '.chp-title',
      ]) {
        chapterTitle = cleanText(
          node.find(titleSelector).first().text(),
        );

        if (
          chapterTitle &&
          !isPlaceholder(chapterTitle)
        ) {
          break;
        }

        chapterTitle = '';
      }

      chapterTitle =
        chapterTitle ||
        cleanText(anchor.attr('title')) ||
        cleanText(anchor.text());

      entries.push({
        chapterId,
        chapterTitle,
        chapterDate: firstText(node, [
          '.chapter-item-time',
          '.chapter-date',
          'time',
        ]),
        url: absoluteUrl(href),
      });
    });

    if (entries.length) return entries;
  }

  return [];
}

function extractImageUrls($, pageUrl) {
  const selectors = [
    '.mangaread-img .pic_box img',
    '.mangaread-img img',
    '.read-content img',
    '.chapter-content img',
    '.reading-content img',
  ];

  for (const selector of selectors) {
    const result = [];
    const seen = new Set();

    $(selector).each((_, element) => {
      const node = $(element);

      const image = absoluteUrl(
        node.attr('src') ||
          node.attr('data-src') ||
          node.attr('data-original') ||
          node.attr('data-lazy-src') ||
          node.attr('lazy_url') ||
          node.attr('cover_url'),
        pageUrl,
      );

      if (image && !seen.has(image)) {
        seen.add(image);
        result.push(image);
      }
    });

    if (result.length) return result;
  }

  return [];
}

function extractReaderPageCount($) {
  const values = [];

  $(
    '.mangaread-page .mangaread-pagenav .sl-page option, ' +
      '.mangaread-pagenav .sl-page option, select option',
  ).each((_, element) => {
    const value = cleanText(
      $(element).attr('value') || $(element).text(),
    );

    const number = Number.parseInt(value, 10);

    if (Number.isFinite(number) && number > 0) {
      values.push(number);
    }
  });

  if (values.length) {
    return Math.max(...values);
  }

  const optionCount = $(
    '.mangaread-page .mangaread-pagenav .sl-page > option',
  ).length;

  return optionCount > 1
    ? Math.max(1, Math.floor(optionCount / 2))
    : 1;
}

// Fetch manga listings from a NovelCool category.
// Parses a novel chapter page (text, not images).
// Page layout: <h2.chapter-title> followed by one <p> per paragraph inside the
// same box, plus .chapter-start-mark / .chapter-end-mark marker paragraphs.
function parseNovelChapter($, url, fallbackChapterId) {
  const titleElement = $('.chapter-title').first();
  const title = cleanText(titleElement.text());

  const paragraphs = [];
  const collect = (box) => {
    box.children('p').each((_, element) => {
      const paragraph = $(element);

      if (
        paragraph.hasClass('chapter-start-mark') ||
        paragraph.hasClass('chapter-end-mark')
      ) {
        return;
      }

      const text = cleanText(paragraph.text());
      if (text) paragraphs.push(text);
    });
  };

  collect(titleElement.parent());
  if (!paragraphs.length) collect($('.site-content .overflow-hidden').first());

  if (!paragraphs.length) {
    const error = new Error(
      'No readable text found in this chapter. For manga chapters use /reader/:ch/:id instead.',
    );
    error.status = 422;
    throw error;
  }

  let previous = null;
  let next = null;

  $('.chapter-reading-pagination')
    .first()
    .find('a[href]')
    .each((_, element) => {
      const link = $(element);
      const label = cleanText(link.text()).toLowerCase();
      const href = absoluteUrl(link.attr('href'), CHAPTER_BASE_URL);
      const target = href
        ? { chapterId: chapterIdFromHref(href), url: href }
        : null;

      if (label.includes('prev')) previous = target;
      else if (label.includes('next')) next = target;
    });

  const bookUrl = absoluteUrl(
    $('#chapter-book-url').first().text(),
    CHAPTER_BASE_URL,
  );
  const bookId = (bookUrl.match(/\/(?:novel|manga)\/([^/]+)\.html/i) || [])[1] || '';
  const text = paragraphs.join('\n\n');

  return {
    chapterId:
      cleanText($('input[name="chapter_id"]').first().attr('value')) ||
      fallbackChapterId,
    title,
    bookId,
    bookUrl,
    previous,
    next,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    paragraphs,
    text,
    sourceUrl: url,
  };
}

async function get_category(categoryUrl) {
  const pageUrl = new URL(
    `category/${categoryUrl}.html`,
    mainUrl(),
  ).href;

  const response = await AxiosGet(pageUrl);
  const $ = cheerio.load(response.data);

  const categoryTitle = firstText($, [
    '.category-headline-bar .category-title',
    'h1',
  ]);

  const mangaList = [];

  $('.site-content .category-book-list .book-item').each(
    (_, mangaElement) => {
      try {
        mangaList.push(getMangas($, mangaElement));
      } catch {
        // Skip a malformed card without losing other results.
      }
    },
  );

  return {
    section: categoryTitle,
    result: mangaList,
    pagination: pagination($),
  };
}

export class Mangas {
  static async get_mangasIndex() {
    const response = await AxiosGet(mainUrl());
    const $ = cheerio.load(response.data);
    const sectionList = [];

    $('.index-book-list').each((_, element) => {
      const section = $(element);

      const nameSection =
        cleanText(
          section.find('.site-content a').first().attr('title'),
        ) ||
        firstText(section, [
          '.category-title',
          'h2',
          'h3',
        ]);

      const mangaList = [];

      section
        .find('.site-content .category-book-list .book-item')
        .each((__, mangaElement) => {
          try {
            mangaList.push(getMangas($, mangaElement));
          } catch {
            // Preserve other homepage cards if one is malformed.
          }
        });

      sectionList.push({
        nameSection,
        mangaList,
      });
    });

    return sectionList;
  }

  static async get_lasted() {
    return get_category('latest');
  }

  static async get_popular(page = 1) {
    return get_category(`popular_${page}`);
  }

  static async get_completed(page = 1) {
    return get_category(`completed_${page}`);
  }

  static async get_category(
    Category_name = 'index',
    page = 1,
  ) {
    return get_category(`${Category_name}_${page}`);
  }

  static async get_info(id) {
    const safeId = String(id ?? '').trim();

    if (!safeId || /[?#]/.test(safeId)) {
      throw badRequest('A valid NovelCool manga ID is required.');
    }

    const url = new URL(
      `novel/${encodeURIComponent(safeId)}.html`,
      mainUrl(),
    ).href;

    const response = await AxiosGet(url);
    const $ = cheerio.load(response.data);

    const imgRaw = firstAttribute(
      $,
      [
        '.bookinfo-pic-img',
        '.bookinfo-pic img',
        '.book-cover img',
        '.bookinfo-cover img',
        'meta[property="og:image"]',
      ],
      [
        'src',
        'data-src',
        'data-original',
        'lazy_url',
        'cover_url',
        'content',
      ],
    );

    const img = absoluteUrl(imgRaw, url);

    const title =
      firstText($, [
        '.bk-side-intro .bk-side-intro-most .bookinfo-title',
        '.bookinfo-title',
        '.book-title',
        'h1[itemprop="name"]',
        'h1',
      ]) ||
      cleanText($('meta[property="og:title"]').attr('content'));

    const bookType = firstText($, [
      '.site-content .bookinfo-module .bk-intro .bookinfo-pic .book-type',
      '.book-type',
      '.book-type-manga',
      '[itemprop="genre"]',
    ]);

    const author =
      firstText($, [
        '.bk-side-intro .bk-side-intro-most .bookinfo-author a span',
        '.bookinfo-author a span',
        '.bookinfo-author a',
        '.book-author',
        '[itemprop="author"]',
      ]) ||
      cleanText($('meta[name="author"]').attr('content'));

    // The website HTML has no views/followers counters (only the mobile app
    // shows them), so they are not returned.
    const rate = firstText($, [
      '.bookinfo-rate-val',
      '.book-rate-num',
      '[itemprop="ratingValue"]',
    ]);

    // NovelCool prints the vote count as "( 12 Votes )".
    const votesMatch = firstText($, ['.bookinfo-vote-num']).match(/-?\d+/);
    const votes = votesMatch ? Number.parseInt(votesMatch[0], 10) : null;

    const status = getStatus($);

    const bookId = cleanText(
      $('.book-follow-trigger').first().attr('book_id'),
    );

    const description = getDescription($);
    const genres = getGenres($);
    const chaptersList = extractChapterEntries($);

    return {
      id: safeId,
      img,
      bookId,
      title,
      bookType,
      status,
      author,
      rate,
      votes,
      description,
      genres,
      chapterCount: chaptersList.length,
      chaptersList,
      sourceUrl: url,
    };
  }

  static async chapter_read(url) {
    const chapterPath = String(url ?? '')
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/^chapter\//i, '')
      .replace(/-\d+-\d+\.html?$/i, '')
      .replace(/\.html?$/i, '');

    if (
      !chapterPath ||
      chapterPath
        .split('/')
        .some((part) => !part || part === '.' || part === '..')
    ) {
      throw badRequest('A valid NovelCool chapter path is required.');
    }

    const baseChapterUrl = new URL(
      `chapter/${chapterPath}-10-1.html`,
      mainUrl(),
    ).href;

    const firstResponse = await AxiosGet(baseChapterUrl);
    const $ = cheerio.load(firstResponse.data);

    const pageCount = Math.min(
      300,
      extractReaderPageCount($),
    );

    const title = firstText($, [
      '.mangaread-title',
      '.chapter-title',
      'h1',
    ]);

    const prevChapter = firstAttribute(
      $,
      ['.mangaread-top .mangaread-prev-btn a'],
      ['href'],
    );

    let nextChapter = firstAttribute(
      $,
      ['.mangaread-top .mangaread-next-btn a'],
      ['href'],
    );

    const imgList = extractImageUrls($, baseChapterUrl);

    for (
      let pageNumber = 2;
      pageNumber <= pageCount;
      pageNumber += 1
    ) {
      const pageUrl = new URL(
        `chapter/${chapterPath}-10-${pageNumber}.html`,
        mainUrl(),
      ).href;

      const pageResponse = await AxiosGet(pageUrl);
      const pageDocument = cheerio.load(pageResponse.data);

      const currentNext = firstAttribute(
        pageDocument,
        ['.mangaread-top .mangaread-next-btn a'],
        ['href'],
      );

      if (currentNext) {
        nextChapter = absoluteUrl(currentNext, pageUrl);
      }

      for (const imageUrl of extractImageUrls(pageDocument, pageUrl)) {
        if (!imgList.includes(imageUrl)) {
          imgList.push(imageUrl);
        }
      }
    }

    return {
      captitle: title,
      prevChapter:
        absoluteUrl(prevChapter, baseChapterUrl) || prevChapter,
      nextChapter:
        absoluteUrl(nextChapter, baseChapterUrl) || nextChapter,
      pages: imgList,
      pageCount,
      sourceUrl: baseChapterUrl,
    };
  }

  // Novel chapters are plain text. `slug` and `id` are the two parts of the
  // chapterId returned by /view/:id (for example "Some-Chapter-Title" and "4752776").
  static async chapter_read_text(slug, id) {
    const chapterSlug = String(slug ?? '').trim();
    const chapterNumber = String(id ?? '').trim();

    if (
      !chapterSlug ||
      /[\\/]/.test(chapterSlug) ||
      chapterSlug === '.' ||
      chapterSlug === '..' ||
      !/^\d+$/.test(chapterNumber)
    ) {
      throw badRequest(
        'A valid chapter slug and numeric chapter ID are required.',
      );
    }

    const url = new URL(
      `chapter/${encodeURIComponent(chapterSlug)}/${chapterNumber}/`,
      CHAPTER_BASE_URL,
    ).href;

    const response = await AxiosGet(url);
    const $ = cheerio.load(response.data);

    return parseNovelChapter($, url, `${chapterSlug}/${chapterNumber}`);
  }

  static async search(
    searchText,
    Author = '',
    textSearchMethod = 'contain',
    autorSearchMehod = 'contain',
    categories_Include = '',
    categories_not_Include = '',
    publishYear = '',
    complete_Series = '',
    rate_star = '',
    page = 1,
  ) {
    const asCommaSeparated = (value) =>
      Array.isArray(value)
        ? value.join(',')
        : String(value ?? '');

    const searchParams = new URLSearchParams({
      name_sel: textSearchMethod || 'contain',
      name: String(searchText ?? ''),
      author_sel: autorSearchMehod || 'contain',
      author: String(Author ?? ''),
      category_id: `,${asCommaSeparated(categories_Include)}`,
      out_category_id: `,${asCommaSeparated(categories_not_Include)}`,
      publish_year: String(publishYear ?? ''),
      completed_series: String(complete_Series ?? ''),
      rate_star: String(rate_star ?? ''),
    });

    // NovelCool's own pager links use "&page=2.html".
    if (page > 1) searchParams.set('page', `${page}.html`);

    const searchUrl = new URL(
      `search/?${searchParams.toString()}`,
      mainUrl(),
    ).href;

    const response = await AxiosGet(searchUrl);
    const $ = cheerio.load(response.data);
    const mangaList = [];

    $('.site-content .category-book-list .book-item').each(
      (_, mangaElement) => {
        try {
          mangaList.push(getMangas($, mangaElement));
        } catch {
          // Skip malformed search cards but retain other matches.
        }
      },
    );

    const genres = filterCategoryList($);

    return {
      head: {
        textSearchMethodOptions: ['contain', 'begin', 'End'],
        autorSearchMehodOptions: ['contain', 'begin', 'End'],
        searchText: searchText ?? 'none',
        Author: Author ?? 'none',
        categories_Include: categories_Include ?? 'none',
        categories_not_Includes: categories_not_Include ?? 'none',
        publishYear: publishYear ?? 'none',
        complete_Series: complete_Series ?? 'none',
        rate_star: rate_star ?? 'none',
        page,
      },
      body: {
        result: mangaList,
        pagination: pagination($),
        genres,
      },
    };
  }

  static async get_GenresList() {
    const url = new URL('category/1947.html', mainUrl()).href;
    const response = await AxiosGet(url);
    const $ = cheerio.load(response.data);

    return getCategoryList($);
  }
}