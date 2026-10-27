//funcion para obtener un objeto con la informacion del manga
export function getMangas($,mangaElement){

    const genresList = [];
    let regex = /\/([^\/]+)\.html$/;
    //elemento padre comun de todos los elementos
    const index = $(mangaElement).find('.book-info');
    const id = $(mangaElement).find('.book-pic a').attr('href').match(regex) 
    const title = index.find('.book-name').text().trim();
    const cover = $(mangaElement).find('.book-pic a img');
    const img = cover.attr('cover_url') ?? cover.attr('lazy_url') ?? cover.attr('src');
    // "Manga" or "Novel" (NovelCool lists both in the same results).
    const type = $(mangaElement).find('.book-pic .book-type').first().text().trim();

     $(mangaElement).find('.book-data-info .book-tags .book-tag').each((genreIndex,genreElement)=>{
        const genre = $(genreElement).text().trim()
        genresList.push(genre)
    });
    const bookRate = index.find('.book-rate .book-rate-num').text().trim();
    const intro = index.find('.book-intro').text().trim();
    const summary = $(mangaElement).find('.book-pic a .book-summary-content').text().trim();
    const isEmpty = (text) => text.length < 2 || /^n\s*\/?\s*a$/i.test(text);
    const description = !isEmpty(intro) ? intro : (!isEmpty(summary) ? summary : '');
    const ratingCount = $(mangaElement).find('meta[itemprop="ratingCount"]').attr('content') ?? '';
    const dataTime = index.find('.book-data').find('.book-data-time').text().trim();
    const mangaObject = {

        id:[...id][1],
        title: title,
        img: img,
        type:type,
        genres: [...genresList],
        bookRate:bookRate,
        description:description,
        ratingCount:ratingCount,
        dataTime:dataTime
    }
    return mangaObject
}