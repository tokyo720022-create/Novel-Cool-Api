import {Mangas} from '../models/mangas.js'


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
        // res.json({
        //     search: query,
        //     author: author,
        //     s_sel:s_sel,
        //     a_sel:a_sel,
        //     genres_includes:genres_includes,
        //     genres_not_includes:genres_not_includes,
        //     year:year,
        //     completed:completed,
        //     rate:rate
        // })
        const  result = await Mangas.search(
            query,
            author,
            s_sel,
            a_sel,
            genres_includes,
            genres_not_includes,
            year,
            completed,
            rate
        )
        res.json(result)

    }
    static async Index(req,res){
        const result = await Mangas.get_mangasIndex()
        res.status(200).json(result)
    }
    static async Lasted(req,res){
        const result = await Mangas.get_lasted()
        res.status(200).json(result)
    }
    static async Popular(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_popular(page)
        res.status(200).json(result)
    }
    static async Complete(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_completed(page)
        res.status(200).json(result)
    }
    static async Romance(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_category('Romance',page)
        res.status(200).json(result)
    }
    static async Comedy(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_category('Comedy',page)
        res.status(200).json(result)
    }
    static async Drama(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_category('Drama',page)
        res.status(200).json(result)
    }
    static async Action(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_category('Action',page)
        res.status(200).json(result)
    }
    static async Webcomic(req,res){
        const page = req.query.page ?? 1
        const result = await Mangas.get_category('Webcomic',page)
        res.status(200).json(result)
    }
    static async Category(req,res){
        const category = req.params.category 
        const page = req.query.page ?? 1
        const result = await Mangas.get_category(category,page)
        res.status(200).json(result)
    }
    static async info(req,res){
        const id = req.params.id
        const result = await Mangas.get_info(id)
        res.json(result)
    }
    static async genres(req,res){
        const result = await Mangas.get_GenresList()
        res.json(result)
    }
    static async reader(req,res){

        const id = req.params.id
        const ch = req.params.ch
        const url = ch + '/' + id
        const result = await Mangas.chapter_read(url)
        res.json(result)
    }
    
    

           }
