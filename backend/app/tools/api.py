import datetime
import logging
import os
import pandas as pd
from typing import Optional, List
import requests
import yfinance as yf

logger = logging.getLogger(__name__)

from app.data.cache import get_cache
from app.data.models import (
    CompanyNews,
    FinancialMetrics,
    Price,
    LineItem,
    InsiderTrade,
)

# Global cache instance
_cache = get_cache()

EODHD_TO_YF_EXCHANGE = {
    "US": "", "LSE": "L", "XETRA": "DE", "F": "F", "PA": "PA", "HE": "HE", 
    "TO": "TO", "V": "V", "AU": "AX", "HK": "HK", "TSE": "T", "SA": "SA", 
    "KO": "KS", "MC": "MC", "MI": "MI", "AS": "AS", "ST": "ST", "VI": "VI", 
    "WA": "WA", "HA": "HA", "VX": "VX", "SW": "SW", "BR": "BR", "BA": "BA"
}

_ticker_cache = {}

def _get_eodhd_api_key(api_key: Optional[str] = None) -> str:
    key = api_key or os.environ.get("EODHD_API_KEY")
    if not key:
        raise ValueError("EODHD_API_KEY is not set.")
    return key

def _resolve_ticker(ticker: str, api_key: str = None) -> tuple[str, str]:
    """
    Resolve a generic ticker like 'NESTE' to EODHD and Yahoo Finance formats.
    Returns: (eodhd_ticker, yf_ticker)
    """
    if "." in ticker:
        # If user explicitly provides the suffix, assume they know what they are doing
        return ticker, ticker
        
    if ticker in _ticker_cache:
        return _ticker_cache[ticker]
        
    eodhd_api_key = _get_eodhd_api_key(api_key)
    
    try:
        url = f"https://eodhd.com/api/search/{ticker}"
        params = {
            "api_token": eodhd_api_key,
            "fmt": "json",
            "limit": 10
        }
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        exact_matches = [item for item in data if item.get("Code", "").upper() == ticker.upper()]
        us_matches = [item for item in exact_matches if item.get("Exchange") == "US"]
        
        if us_matches:
            best_match = us_matches[0]
        elif exact_matches:
            best_match = exact_matches[0]
        elif data:
            best_match = data[0]
        else:
            _ticker_cache[ticker] = (f"{ticker}.US", ticker)
            return _ticker_cache[ticker]
            
        code = best_match.get("Code", ticker)
        exchange = best_match.get("Exchange", "US")
        
        eodhd_ticker = f"{code}.{exchange}" if exchange != "US" else f"{code}.US"
        yf_suffix = EODHD_TO_YF_EXCHANGE.get(exchange, exchange)
        yf_ticker = f"{code}.{yf_suffix}" if yf_suffix else code
        
        _ticker_cache[ticker] = (eodhd_ticker, yf_ticker)
        return _ticker_cache[ticker]
        
    except Exception as e:
        logger.warning(f"Could not resolve ticker {ticker}: {e}")
        _ticker_cache[ticker] = (f"{ticker}.US", ticker)
        return _ticker_cache[ticker]

def get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    """Fetch price data from cache or API."""
    cache_key = f"{ticker}_{start_date}_{end_date}"
    if cached_data := _cache.get_prices(cache_key):
        return [Price(**price) for price in cached_data]

    eodhd_ticker, yf_ticker = _resolve_ticker(ticker, api_key)
    
    try:
        # Fetch data using yfinance
        # yfinance end date is exclusive, so we add 1 day to end_date
        end_date_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d")
        end_date_exclusive = (end_date_dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        hist = yf.Ticker(yf_ticker).history(start=start_date, end=end_date_exclusive)
    except Exception as e:
        logger.warning(f"Could not fetch prices for {ticker} from yfinance: {e}")
        return []

    prices = []
    for date, row in hist.iterrows():
        try:
            # yfinance returns pandas DatetimeIndex, convert to string
            date_str = date.strftime("%Y-%m-%d")
            price = Price(
                open=float(row['Open']) or 0.0,
                close=float(row['Close']) or 0.0,
                high=float(row['High']) or 0.0,
                low=float(row['Low']) or 0.0,
                volume=int(row['Volume']) or 0,
                time=date_str
            )
            prices.append(price)
        except Exception as e:
            logger.warning(f"Failed to parse price data for {ticker} on {date}: {e}")
            
    if prices:
        _cache.set_prices(cache_key, [p.model_dump() for p in prices])
    return prices


def get_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    """Fetch financial metrics from cache or API."""
    cache_key = f"{ticker}_{period}_{end_date}_{limit}"
    if cached_data := _cache.get_financial_metrics(cache_key):
        return [FinancialMetrics(**metric) for metric in cached_data]

    eodhd_api_key = _get_eodhd_api_key(api_key)
    eodhd_ticker, _ = _resolve_ticker(ticker, api_key)
    
    try:
        url = f"https://eodhd.com/api/fundamentals/{eodhd_ticker}"
        params = {
            "api_token": eodhd_api_key,
            "fmt": "json"
        }
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        logger.warning(f"Could not fetch financial metrics for {ticker}: {e}")
        return []

    financials = data.get("Financials", {})
    statement_period = "yearly" if period == "annual" else "quarterly"
    
    income = financials.get("Income_Statement", {}).get(statement_period, {})
    balance = financials.get("Balance_Sheet", {}).get(statement_period, {})
    cashflow = financials.get("Cash_Flow", {}).get(statement_period, {})
    
    # Sort dates and filter by end_date
    dates = sorted([d for d in income.keys() if d <= end_date], reverse=True)[:limit]

    financial_metrics = []
    for d in dates:
        inc = income.get(d, {})
        bal = balance.get(d, {})
        cf = cashflow.get(d, {})
        
        # Helper to safely parse floats
        def safe_float(val):
            if val is None or val == "":
                return None
            try:
                return float(val)
            except ValueError:
                return None

        # Financial statement values
        total_revenue = safe_float(inc.get("totalRevenue"))
        gross_profit = safe_float(inc.get("grossProfit"))
        operating_income = safe_float(inc.get("operatingIncome"))
        net_income = safe_float(inc.get("netIncome"))
        
        total_assets = safe_float(bal.get("totalAssets"))
        total_equity = safe_float(bal.get("totalStockholderEquity"))
        current_assets = safe_float(bal.get("totalCurrentAssets"))
        current_liabilities = safe_float(bal.get("totalCurrentLiabilities"))
        long_term_debt = safe_float(bal.get("longTermDebt")) or 0
        short_term_debt = safe_float(bal.get("shortTermDebt")) or 0
        total_debt = long_term_debt + short_term_debt
        shares_outstanding = safe_float(bal.get("commonStockSharesOutstanding"))
        
        free_cash_flow = safe_float(cf.get("freeCashFlow"))

        metric = FinancialMetrics(
            ticker=ticker,
            report_period=d,
            period=period,
            currency=inc.get("currency_symbol") or "USD",
            market_cap=None, # Not typically available in historical statements, usually computed dynamically or obtained from highlights
            enterprise_value=None,
            price_to_earnings_ratio=None,
            price_to_book_ratio=None,
            peg_ratio=None,
            
            current_ratio=(current_assets / current_liabilities) if current_assets and current_liabilities else None,
            return_on_equity=(net_income / total_equity) if net_income and total_equity else None,
            return_on_assets=(net_income / total_assets) if net_income and total_assets else None,
            debt_to_equity=(total_debt / total_equity) if total_debt and total_equity else None,
            debt_to_assets=(total_debt / total_assets) if total_debt and total_assets else None,
            gross_margin=(gross_profit / total_revenue) if gross_profit and total_revenue else None,
            operating_margin=(operating_income / total_revenue) if operating_income and total_revenue else None,
            net_margin=(net_income / total_revenue) if net_income and total_revenue else None,
            book_value_per_share=(total_equity / shares_outstanding) if total_equity and shares_outstanding else None,
            
            earnings_per_share=(net_income / shares_outstanding) if net_income and shares_outstanding else None,
            free_cash_flow_per_share=(free_cash_flow / shares_outstanding) if free_cash_flow and shares_outstanding else None,
            
            # Other fields left as None
            price_to_sales_ratio=None,
            enterprise_value_to_ebitda_ratio=None,
            enterprise_value_to_revenue_ratio=None,
            free_cash_flow_yield=None,
            return_on_invested_capital=None,
            asset_turnover=None,
            inventory_turnover=None,
            receivables_turnover=None,
            days_sales_outstanding=None,
            operating_cycle=None,
            working_capital_turnover=None,
            quick_ratio=None,
            cash_ratio=None,
            operating_cash_flow_ratio=None,
            interest_coverage=None,
            book_value_growth=None,
            earnings_per_share_growth=None,
            free_cash_flow_growth=None,
            operating_income_growth=None,
            ebitda_growth=None,
            payout_ratio=None,
            revenue_growth=None,
            earnings_growth=None,
        )
        financial_metrics.append(metric)

    if financial_metrics:
        _cache.set_financial_metrics(cache_key, [m.model_dump() for m in financial_metrics])
    return financial_metrics


def search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    """Fetch line items from API."""
    eodhd_api_key = _get_eodhd_api_key(api_key)
    eodhd_ticker, _ = _resolve_ticker(ticker, api_key)
    
    try:
        url = f"https://eodhd.com/api/fundamentals/{eodhd_ticker}"
        params = {
            "api_token": eodhd_api_key,
            "fmt": "json"
        }
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        logger.warning(f"Could not fetch line items for {ticker}: {e}")
        return []

    financials = data.get("Financials", {})
    statement_period = "yearly" if period == "annual" else "quarterly"
    
    income = financials.get("Income_Statement", {}).get(statement_period, {})
    balance = financials.get("Balance_Sheet", {}).get(statement_period, {})
    cashflow = financials.get("Cash_Flow", {}).get(statement_period, {})
    
    dates = sorted([d for d in income.keys() if d <= end_date], reverse=True)[:limit]
    
    results = []
    for d in dates:
        flat_data = {}
        # Merge all statements for the given date
        for stmt in [income, balance, cashflow]:
            if d in stmt:
                for k, v in stmt[d].items():
                    if k not in ['date', 'filing_date', 'currency_symbol']:
                        try:
                            flat_data[k] = float(v) if v is not None and v != "" else None
                        except:
                            flat_data[k] = v

        # EODHD to Tiingo key mapping to ensure backward compatibility for agents
        eodhd_to_tiingo = {
            "capitalExpenditures": "capital_expenditure",
            "depreciation": "depreciation_and_amortization",
            "netIncome": "net_income",
            "commonStockSharesOutstanding": "outstanding_shares",
            "totalAssets": "total_assets",
            "totalLiab": "total_liabilities",
            "totalStockholderEquity": "shareholders_equity",
            "dividendsPaid": "dividends_and_other_cash_distributions",
            "salePurchaseOfStock": "issuance_or_purchase_of_equity_shares",
            "grossProfit": "gross_profit",
            "totalRevenue": "revenue",
            "freeCashFlow": "free_cash_flow",
            "netWorkingCapital": "working_capital",
            "interestExpense": "interest_expense",
            "incomeTaxExpense": "tax_provision",
            "ebit": "ebit",
            "totalDebt": "total_debt",
            "cashAndEquivalents": "cash_and_equivalents",
            "totalCurrentAssets": "current_assets",
            "totalCurrentLiabilities": "current_liabilities",
            "operatingIncome": "operating_income",
            "retainedEarnings": "retained_earnings",
            "researchDevelopment": "research_and_development",
            "totalOperatingExpenses": "operating_expense",
        }
        
        # Add the tiingo keys to flat_data
        for eodhd_key, tiingo_key in eodhd_to_tiingo.items():
            if eodhd_key in flat_data and tiingo_key not in flat_data:
                flat_data[tiingo_key] = flat_data[eodhd_key]
                
        # Compute totalDebt if missing
        if 'totalDebt' not in flat_data:
            st = flat_data.get('shortTermDebt') or 0
            lt = flat_data.get('longTermDebt') or 0
            flat_data['totalDebt'] = st + lt
            flat_data['total_debt'] = st + lt
            
        # Compute earnings_per_share if missing
        if 'earnings_per_share' not in flat_data:
            ni = flat_data.get('netIncome')
            shares = flat_data.get('commonStockSharesOutstanding')
            if ni is not None and shares is not None and shares > 0:
                flat_data['earnings_per_share'] = ni / shares
            else:
                flat_data['earnings_per_share'] = None
                
        # Compute book_value_per_share if missing
        if 'book_value_per_share' not in flat_data:
            equity = flat_data.get('totalStockholderEquity')
            shares = flat_data.get('commonStockSharesOutstanding')
            if equity is not None and shares is not None and shares > 0:
                flat_data['book_value_per_share'] = equity / shares
            else:
                flat_data['book_value_per_share'] = None

        # Compute additional derived metrics
        gp = flat_data.get('grossProfit')
        rev = flat_data.get('totalRevenue')
        if gp is not None and rev is not None and rev > 0:
            flat_data['gross_margin'] = gp / rev
            
        op = flat_data.get('operatingIncome')
        if op is not None and rev is not None and rev > 0:
            flat_data['operating_margin'] = op / rev
            
        debt = flat_data.get('totalDebt')
        equity = flat_data.get('totalStockholderEquity')
        if debt is not None and equity is not None and equity > 0:
            flat_data['debt_to_equity'] = debt / equity
            
        goodwill = flat_data.get('goodWill') or 0
        intangible = flat_data.get('intangibleAssets') or 0
        flat_data['goodwill_and_intangible_assets'] = goodwill + intangible
        
        # Compute ebit if missing
        if 'ebit' not in flat_data or flat_data['ebit'] is None:
            op_inc = flat_data.get('operatingIncome')
            if op_inc is not None:
                flat_data['ebit'] = op_inc

        # Compute ebitda if missing
        if 'ebitda' not in flat_data or flat_data['ebitda'] is None:
            ebit_val = flat_data.get('ebit')
            dep_amort = flat_data.get('depreciation') or flat_data.get('depreciationAndAmortization') or 0
            if ebit_val is not None:
                flat_data['ebitda'] = ebit_val + dep_amort
        
        ebit = flat_data.get('ebit')
        tax = flat_data.get('incomeTaxExpense')
        if ebit is not None and tax is not None and debt is not None and equity is not None:
            invested_capital = debt + equity
            if invested_capital > 0:
                flat_data['return_on_invested_capital'] = (ebit - tax) / invested_capital

        line_item_data = {
            "ticker": ticker,
            "report_period": d,
            "period": period,
            "currency": income.get(d, {}).get("currency_symbol") or "USD"
        }
        
        for k, v in flat_data.items():
            line_item_data[k] = v
            
        results.append(LineItem(**line_item_data))

    return results


def get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    """Fetch insider trades."""
    eodhd_api_key = _get_eodhd_api_key(api_key)
    eodhd_ticker, _ = _resolve_ticker(ticker, api_key)
    
    try:
        url = "https://eodhd.com/api/insider-transactions"
        params = {
            "api_token": eodhd_api_key,
            "code": eodhd_ticker,
            "limit": limit
        }
        if start_date:
            params["from"] = start_date
        if end_date:
            params["to"] = end_date
            
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        logger.warning(f"Could not fetch insider trades for {ticker}: {e}")
        return []

    trades = []
    for item in data:
        try:
            # Handle possible null values safely
            def safe_float(v):
                return float(v) if v is not None else None
                
            trade = InsiderTrade(
                ticker=ticker,
                issuer=None,
                name=item.get("ownerName"),
                title=item.get("ownerTitle"),
                is_board_director=None,
                transaction_date=item.get("transactionDate"),
                transaction_shares=safe_float(item.get("transactionAmount")),
                transaction_price_per_share=safe_float(item.get("transactionPrice")),
                transaction_value=None, # Can be computed but leaving as None if not provided
                shares_owned_before_transaction=None,
                shares_owned_after_transaction=safe_float(item.get("postTransactionAmount")),
                security_title=None,
                filing_date=item.get("reportDate") or ""
            )
            trades.append(trade)
        except Exception as e:
            logger.warning(f"Failed to parse insider trade data for {ticker}: {e}")

    return trades


def get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 100,
    api_key: str = None,
) -> list[CompanyNews]:
    """Fetch company news from cache or API."""
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached_data := _cache.get_company_news(cache_key):
        return [CompanyNews(**news) for news in cached_data]

    eodhd_api_key = _get_eodhd_api_key(api_key)
    eodhd_ticker, _ = _resolve_ticker(ticker, api_key)
    
    try:
        url = "https://eodhd.com/api/news"
        params = {
            "api_token": eodhd_api_key,
            "s": eodhd_ticker,
            "limit": limit
        }
        if start_date:
            params["from"] = start_date
        if end_date:
            params["to"] = end_date
            
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        logger.warning(f"Could not fetch company news for {ticker}: {e}")
        return []

    all_news = []
    for item in data:
        try:
            news = CompanyNews(
                ticker=ticker,
                title=item.get('title', ''),
                author=None,
                source=item.get('source', ''),
                date=item.get('date', ''),
                url=item.get('link', ''),
                sentiment=None
            )
            all_news.append(news)
        except Exception as e:
            logger.warning(f"Failed to parse company news for {ticker}: {e}")
            
    if all_news:
        _cache.set_company_news(cache_key, [news.model_dump() for news in all_news])
    return all_news


def get_market_cap(
    ticker: str,
    end_date: str,
    api_key: str = None,
) -> float | None:
    """Fetch market cap from the API."""
    eodhd_api_key = _get_eodhd_api_key(api_key)
    eodhd_ticker, _ = _resolve_ticker(ticker, api_key)
    
    try:
        url = f"https://eodhd.com/api/fundamentals/{eodhd_ticker}"
        params = {
            "api_token": eodhd_api_key,
            "fmt": "json"
        }
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        highlights = data.get("Highlights", {})
        mc = highlights.get("MarketCapitalization")
        if mc is not None:
            return float(mc)
    except Exception as e:
        logger.warning(f"Could not fetch market cap for {ticker}: {e}")
        
    return None


def prices_to_df(prices: list[Price]) -> pd.DataFrame:
    """Convert prices to a DataFrame."""
    df = pd.DataFrame([p.model_dump() for p in prices])
    df["Date"] = pd.to_datetime(df["time"])
    df.set_index("Date", inplace=True)
    numeric_cols = ["open", "close", "high", "low", "volume"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df.sort_index(inplace=True)
    return df


def get_price_data(ticker: str, start_date: str, end_date: str, api_key: str = None) -> pd.DataFrame:
    prices = get_prices(ticker, start_date, end_date, api_key=api_key)
    return prices_to_df(prices)
