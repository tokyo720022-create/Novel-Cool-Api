// NovelCool pagination markup (English site):
//   .page-navone .page-number / .select   -> page buttons
//   .page-navone .page-nav-center-num     -> "1/2" (current / last)
export function pagination($) {
    const nav = $('.page-navone').first()

    let currentPage = Number.parseInt(nav.find('.select').first().text().trim(), 10)
    let lastPage = Number.NaN

    const center = nav.find('.page-nav-center-num').first().text().trim()
    const match = center.match(/(\d+)\s*\/\s*(\d+)/)
    if (match) {
        if (!Number.isFinite(currentPage)) currentPage = Number.parseInt(match[1], 10)
        lastPage = Number.parseInt(match[2], 10)
    }

    if (!Number.isFinite(lastPage)) {
        // Fall back to the highest page button that is visible.
        const numbers = nav
            .find('.select, .page-number')
            .map((_, el) => Number.parseInt($(el).text().trim(), 10))
            .get()
            .filter(Number.isFinite)
        lastPage = numbers.length ? Math.max(...numbers) : (Number.isFinite(currentPage) ? currentPage : 1)
    }

    if (!Number.isFinite(currentPage)) currentPage = 1

    return { currentPage, lastPage }
}
