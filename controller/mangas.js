import { Mangas } from '../models/mangas.js'
import { filterByType } from '../models/modules/filters.js'
import { cached, TTL } from '../models/modules/cache.js'

function badRequest(message) {
    const error = new Error(message)
    error.status = 400
    return error
}

// ?page=2  (default 1)
function parsePage(value) {
    if (value === undefined || value === '') return 1
    const page = Number(value)
    if (!Number.isInteger(page) || page < 1 || page > 1000) {
        throw badRequest('page must be a whole number between 1 and 1000.')
    }
    return page
}

// ?type=manga | ?type=novel  (default: both)
function parseType(value) {
    if (value === undefined || value === '') return ''
    const type = String(value).toLowerCase()
    if (type !== 'manga' && type !== 'novel') {
        throw badRequest('type must be "manga" or "novel".')
    }
    return type
}

// /category/:category -> letters, digits, spaces, _ & ' -
function parseCategory(value) {
    const category = String(value ?? '').trim()
    if (!/^[\p{L}\p{N} _&'-]{1,60}$/u.test(category)) {
        throw badRequest('Invalid category name.')
    }
    return category
}

// Answers from the cache when possible. The cache holds the unfiltered result,
// `transform` (e.g. the manga/novel filter) is applied on the way out.
async function respond(res, key, ttlMs, loader, transform = (value) => value) {
    const { value, status } = await cached(key, ttlMs, loader)
    res.set('X-Cache', status)
    if (ttlMs > 0) res.set('Cache-Control', `public, max-age=${Math.round(ttlMs / 1000)}`)
    res.status(200).json(transform(value))
}

// Handler for any "list of titles" page: /romance, /comedy, ...
const categoryList = (name) => async (req, res) => {
    const page = parsePage(req.query.page)
    const type = parseType(req.query.type)
    await respond(
        res,
        `category:${name}:${page}`,
        TTL.list,
        () => Mangas.get_category(name, page),
        (value) => filterByType(value, type),
    )
}

export class MangaController{

    static async search(req,res){
        let {
         query,
         author,
         s_sel,
         a_sel,
         genres_includes,
         genres_not_includes,
         year,
         completed ,
         rate,
        } = req.query

        const page = parsePage(req.query.page)
        const type = parseType(req.query.type)

        if(genres_includes){
         genres_includes= String(genres_includes).split('%G')
        }
        if(genres_not_includes){
            genres_not_includes= String(genres_not_includes).split('%G')
        }
        const currentYear = new Date().getFullYear()
        const yearNumber = Number.parseInt(year, 10)
        year = Number.isInteger(yearNumber) && yearNumber >= 1943 && yearNumber <= currentYear
            ? yearNumber
            : ''
        const rateNumber = Number.parseInt(rate, 10)
        rate = Number.isInteger(rateNumber) && rateNumber >= 1 && rateNumber <= 5
            ? rateNumber
            : ''

        const key = 'search:' + JSON.stringify([
            query, author, s_sel, a_sel, genres_includes, genres_not_includes, year, completed, rate, page,
        ])

        await respond(
            res,
            key,
            TTL.search,
            () => Mangas.search(
                query,
                author,
                s_sel,
                a_sel,
                genres_includes,
                genres_not_includes,
                year,
                completed,
                rate,
                page,
            ),
            (value) => filterByType(value, type),
        )
    }

    static async Index(req,res){
        await respond(res, 'index', TTL.list, () => Mangas.get_mangasIndex())
    }
    static async Lasted(req,res){
        const type = parseType(req.query.type)
        await respond(res, 'lasted', TTL.list, () => Mangas.get_lasted(), (value) => filterByType(value, type))
    }
    static async Popular(req,res){
        const page = parsePage(req.query.page)
        const type = parseType(req.query.type)
        await respond(res, `popular:${page}`, TTL.list, () => Mangas.get_popular(page), (value) => filterByType(value, type))
    }
    static async Complete(req,res){
        const page = parsePage(req.query.page)
        const type = parseType(req.query.type)
        await respond(res, `completed:${page}`, TTL.list, () => Mangas.get_completed(page), (value) => filterByType(value, type))
    }

    static Romance = categoryList('Romance')
    static Comedy = categoryList('Comedy')
    static Drama = categoryList('Drama')
    static Action = categoryList('Action')
    static Webcomic = categoryList('Webcomic')

    static async Category(req,res){
        const category = parseCategory(req.params.category)
        await categoryList(category)(req, res)
    }

    static async info(req,res){
        const id = req.params.id
        await respond(res, `view:${id}`, TTL.detail, () => Mangas.get_info(id))
    }
    static async genres(req,res){
        await respond(res, 'genres', TTL.genres, () => Mangas.get_GenresList())
    }

    // Manga chapter -> list of page image URLs
    static async reader(req,res){
        const id = req.params.id
        const ch = req.params.ch
        const url = ch + '/' + id
        await respond(res, `reader:${url}`, TTL.reader, () => Mangas.chapter_read(url))
    }

    // Novel chapter -> text
    static async novelReader(req,res){
        const { ch, id } = req.params
        await respond(res, `novel:${ch}/${id}`, TTL.reader, () => Mangas.chapter_read_text(ch, id))
    }
}
