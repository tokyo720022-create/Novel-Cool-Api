import cheerio from 'cheerio';
import axios from 'axios';
import { getCategoryList, filterCategoryList } from './modules/categoryList.js';
import { pagination } from './modules/pagination.js';
import { getMangas } from './modules/getMangas.js';

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

// Defaults to the English site.
// Optionally set NOVELCOOL_LANGUAGE to another supported locale.
const mainUrl = (language = process.env.NOVELCOOL_LANGUAGE || 'en') =>
  `https://${language}.novelcool.com/`;

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

async function AxiosGet(url) {
  return axios.get(url, axiosHead);
}

function firstText($, selectors, { minLength = 1 } = {}) {
  for (const selector of selectors) {
    let value = '';

    $(selector).each((_, element) => {
      if (value) return;

      const candidate = cleanText($(element).text());

      if (
        !isPlaceholder(candidate) &&
        candidate.length >= minLength
      ) {
        value = candidate;
      }
    });

    if (value) return value;
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

function getGenres($) {
  const selectors = [
    '.for-pc .bk-cates .bookinfo-category-list > .bk-cate-item',
    '.bookinfo-category-list .bk-cate-item',
    '.bookinfo-category-list a',
    '.bk-cates a',
    '.book-tags .book-tag',
    '.book-data-info .book-tags .book-tag',
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
        chapterViews: firstText(node, [
          '.chapter-item-views span',
          '.chapter-views',
          '.chapter-views span',
        ]),
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

    const statValues = [];

    $(
      '.for-pc .bk-data .bk-data-val, ' +
        '.bk-data .bk-data-val, ' +
        '.book-data-item .book-data-num',
    ).each((_, element) => {
      const value = cleanText($(element).text());

      if (value && !isPlaceholder(value)) {
        statValues.push(value);
      }
    });

    const followers =
      firstText($, [
        '.for-pc .bk-data > :first-child .bk-data-val',
        '.book-followers',
        '[data-stat="followers"]',
      ]) ||
      statValues[0] ||
      '';

    const rate =
      firstText($, [
        '.for-pc .bk-data > :nth-child(2) .bk-data-val',
        '.book-rate-num',
        '.book-rating',
        '[itemprop="ratingValue"]',
      ]) ||
      statValues[1] ||
      '';

    const views =
      firstText($, [
        '.for-pc .bk-data > :last-child .bk-data-val',
        '.book-views',
        '[data-stat="views"]',
      ]) ||
      statValues[2] ||
      '';

    const description = getDescription($);
    const genres = getGenres($);
    const chaptersList = extractChapterEntries($);

    return {
      id: safeId,
      img,
      title,
      bookType,
      author,
      followers,
      rate,
      views,
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
      },
      body: {
        result: mangaList,
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