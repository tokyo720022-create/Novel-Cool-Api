import express from 'express'
import { mangasRouter } from './router/mangas.js';
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler.js'
const app = express()
const PORT = process.env.PORT ?? 1234;

app.use(cors())
app.get('/health',(req,res)=>{
    res.json({ status: 'ok', uptime: process.uptime() })
})
app.use('/api/v1',mangasRouter)

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
           health: '/health',

        }
    })
})
// Must be registered after all routes.
app.use(errorHandler)

app.listen(PORT,()=>{
    console.log('servidor en Linea en el puerto : '+ PORT)
})
