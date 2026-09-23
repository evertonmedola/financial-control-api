// GET /reports/net-balance takes no query parameters (T-06-05's "narrowest
// possible input surface" intent). Binding @Query() to this empty DTO still
// routes the query string through the global
// ValidationPipe({whitelist: true, forbidNonWhitelisted: true}), so any
// unexpected/spoofed param (e.g. a client-supplied `userId`) is rejected
// with 400 instead of silently ignored — the same structural guarantee
// CategorySummaryQueryDto and MonthComparisonQueryDto already provide for
// their routes.
export class NetBalanceQueryDto {}
