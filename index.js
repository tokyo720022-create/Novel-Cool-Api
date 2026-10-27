import express from 'express'
import { mangasRouter } from './router/mangas.js';
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler.js'
import { globalLimiter } from './middleware/rateLimit.js'
import { cacheStats } from './models/modules/cache.js'
import { upstream } from './models/modules/limiter.js'
const app = express()
const PORT = process.env.PORT ?? 1234;

app.disable('x-powered-by')
// Behind a proxy (Vercel, nginx...) the client IP comes from X-Forwarded-For.
// Only trust it when you really are behind one, or clients could fake their IP.
if (process.env.TRUST_PROXY || process.env.VERCEL) {
    app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY, 10) || 1)
}

app.use(cors({ exposedHeaders: ['X-Cache', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'] }))
// Health check is registered before the rate limiter so monitors never get 429.
app.get('/health',(req,res)=>{
    res.json({ status: 'ok', uptime: process.uptime(), cache: cacheStats(), upstream: upstream.stats() })
})
app.use('/api/v1', globalLimiter, mangasRouter)

 app.get('*',(req,res)=>{
    res.json({
        message: 'route not exist',
        initRouter:'/api/v1',
        routes: {
           indexPage: '/index',
           lastRelease:'/lasted',
           categories:['/complete','/romance', '/comedy','/drama','/action','/webcomic'],
           anyCategory: '/category/:category',
           search: '/search',
           getMangaInfoById:'/view/:mangaId',
           getGenresList:'/info/genres',
           getMangaChapterPages:'/reader/:mangaId/:chapterId',
           getNovelChapterText:'/reader/novel/:chapterSlug/:chapterId',
           listQueryParams:'?page=2&type=manga|novel',
           health: '/health',

        }
    })
})
// Must be registered after all routes.
app.use(errorHandler)

app.listen(PORT,()=>{
    console.log('servidor en Linea en el puerto : '+ PORT)
})
