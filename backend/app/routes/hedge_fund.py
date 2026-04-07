from fastapi import APIRouter, HTTPException, Request, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import asyncio
import json
import base64
from typing import Dict, Any

from app.database import get_db
from app.models.schemas import ErrorResponse, HedgeFundRequest, BacktestRequest, BacktestDayResult, BacktestPerformanceMetrics
from app.models.events import StartEvent, ProgressUpdateEvent, ErrorEvent, CompleteEvent
from app.services.graph import create_graph, parse_hedge_fund_response, run_graph_async
from app.services.portfolio import create_portfolio
from app.services.backtest_service import BacktestService
from app.services.api_key_service import ApiKeyService
from app.utils.progress import progress
from app.utils.analysts import get_agents_list
from app.llm.models import get_model, ModelProvider
from io import BytesIO
from langchain_core.messages import HumanMessage
import yfinance as yf

router = APIRouter(prefix="/hedge-fund")

def clean_number_string(val, is_price=False):
    if not isinstance(val, str):
        val = str(val)
    # Remove all spaces
    val = val.replace(' ', '')
    # If it has both comma and dot (e.g. 1,234.56 or 1.234,56)
    if ',' in val and '.' in val:
        # If comma comes before dot, it's a thousands separator
        if val.rfind(',') < val.rfind('.'):
            val = val.replace(',', '')
        # If dot comes before comma, dot is thousands separator, comma is decimal
        else:
            val = val.replace('.', '').replace(',', '.')
    # If it only has comma (e.g. 7,94)
    elif ',' in val:
        val = val.replace(',', '.')
        
    if is_price:
        try:
            return f"{float(val):.2f}"
        except ValueError:
            pass
            
    return val

@router.post(
    path="/upload",
    responses={
        200: {"description": "Successfully parsed file"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload and parse a file using OpenAI."""
    try:
        content = await file.read()
        file_ext = file.filename.split('.')[-1].lower() if '.' in file.filename else ''
        
        extracted_text = ""
        image_data = None
        
        if file_ext in ['txt', 'csv', 'json', 'md']:
            extracted_text = content.decode('utf-8', errors='ignore')
        elif file_ext in ['pdf', 'png', 'jpg', 'jpeg', 'webp']:
            image_data = base64.b64encode(content).decode('utf-8')
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format")

        prompt = """
        You are an expert financial assistant. Analyze the provided data and determine if it represents a list of stock tickers to analyze, or a portfolio with current positions.
        
        Output valid JSON exactly matching one of the two following formats, and do not output any other text:
        
        Format 1 (For just a list of stocks/tickers):
        {
            "type": "stock",
            "tickers": ["AAPL", "MSFT", "TSLA"]
        }
        
        Format 2 (For a portfolio with quantities and prices):
        {
            "type": "portfolio",
            "positions": [
                {"ticker": "AAPL", "quantity": "100", "tradePrice": "150.50"},
                {"ticker": "MSFT", "quantity": "50"}
            ]
        }
        
        If the file has quantities, use Format 2. Otherwise use Format 1. Convert all tickers to uppercase symbols.
        CRITICAL INSTRUCTIONS FOR FORMAT 2:
        - "tradePrice": Extract the price ONLY if it is explicitly stated in the document. DO NOT hallucinate, guess, or look up prices. If the document does not contain a price for a position, omit the "tradePrice" field completely for that position.
        - Normalize all numbers: DO NOT output strings with commas (,) for decimals or thousands. Convert values like "7,94" to "7.94" and "1,000.50" to "1000.50" directly in your JSON output.
        - Precision: Keep exact precision for all trade prices (e.g. "133.97"). Do not round to whole numbers unless the source text has it rounded.
        """

        messages = []
        if extracted_text:
            messages.append(HumanMessage(content=prompt + "\n\nData:\n" + extracted_text[:15000]))
        elif image_data:
            mime_type = "application/pdf" if file_ext == "pdf" else f"image/{file_ext}"
            messages.append(HumanMessage(content=[
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{image_data}"}
                }
            ]))
            
        api_key_service = ApiKeyService(db)
        api_keys = api_key_service.get_api_keys_dict()
        
        llm = get_model("gpt-5.4", ModelProvider.OPENAI, api_keys)
        if not llm:
            raise ValueError("Could not initialize OpenAI model")
            
        response = llm.invoke(messages)
        
        response_text = response.content.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()
        elif response_text.startswith("```"):
            response_text = response_text[3:-3].strip()
            
        result = json.loads(response_text)
        
        # Hydrate missing prices using yfinance for portfolio mode
        if result.get("type") == "portfolio" and "positions" in result:
            for position in result["positions"]:
                ticker = position.get("ticker")
                price = position.get("tradePrice") or position.get("price") or position.get("trade_price")
                quantity = position.get("quantity")
                
                # Clean strings to float format
                if price:
                    position["tradePrice"] = clean_number_string(price, is_price=True)
                if quantity:
                    position["quantity"] = clean_number_string(quantity, is_price=False)
                
                # If we have a ticker and quantity but no price (or price is 0/empty), fetch it
                if ticker and quantity and not price:
                    try:
                        ticker_obj = yf.Ticker(ticker)
                        # Try to get current price
                        current_price = None
                        
                        # Use fast info property if available
                        if hasattr(ticker_obj, 'fast_info') and hasattr(ticker_obj.fast_info, 'last_price'):
                            current_price = ticker_obj.fast_info.last_price
                        else:
                            # Fallback to info dict
                            info = ticker_obj.info
                            if "currentPrice" in info:
                                current_price = info["currentPrice"]
                            elif "regularMarketPrice" in info:
                                current_price = info["regularMarketPrice"]
                            elif "previousClose" in info:
                                current_price = info["previousClose"]
                            
                        if current_price:
                            position["tradePrice"] = f"{current_price:.2f}"
                            print(f"Hydrated price for {ticker}: {current_price}")
                    except Exception as e:
                        print(f"Failed to fetch price for {ticker} using yfinance: {e}")

        return result

    except Exception as e:
        print(f"Error parsing file: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post(
    path="/run",
    responses={
        200: {"description": "Successful response with streaming updates"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def run(request_data: HedgeFundRequest, request: Request, db: Session = Depends(get_db)):
    try:
        # Hydrate API keys from database if not provided
        if not request_data.api_keys:
            api_key_service = ApiKeyService(db)
            request_data.api_keys = api_key_service.get_api_keys_dict()

        # Create the portfolio
        portfolio = create_portfolio(request_data.initial_cash, request_data.margin_requirement, request_data.tickers, request_data.portfolio_positions)

        # Construct agent graph using the React Flow graph structure
        graph = create_graph(
            graph_nodes=request_data.graph_nodes,
            graph_edges=request_data.graph_edges
        )
        graph = graph.compile()

        # Log a test progress update for debugging
        progress.update_status("system", None, "Preparing hedge fund run")

        # Convert model_provider to string if it's an enum
        model_provider = request_data.model_provider
        if hasattr(model_provider, "value"):
            model_provider = model_provider.value

        # Function to detect client disconnection
        async def wait_for_disconnect():
            """Wait for client disconnect and return True when it happens"""
            try:
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        return True
            except Exception:
                return True

        # Set up streaming response
        async def event_generator():
            # Queue for progress updates
            progress_queue = asyncio.Queue()
            run_task = None
            disconnect_task = None

            # Simple handler to add updates to the queue
            def progress_handler(agent_name, ticker, status, analysis, timestamp):
                event = ProgressUpdateEvent(agent=agent_name, ticker=ticker, status=status, timestamp=timestamp, analysis=analysis)
                progress_queue.put_nowait(event)

            # Register our handler with the progress tracker
            progress.register_handler(progress_handler)

            try:
                # Start the graph execution in a background task
                run_task = asyncio.create_task(
                    run_graph_async(
                        graph=graph,
                        portfolio=portfolio,
                        tickers=request_data.tickers,
                        start_date=request_data.start_date,
                        end_date=request_data.end_date,
                        model_name=request_data.model_name,
                        model_provider=model_provider,
                        request=request_data,  # Pass the full request for agent-specific model access
                    )
                )
                
                # Start the disconnect detection task
                disconnect_task = asyncio.create_task(wait_for_disconnect())
                
                # Send initial message
                yield StartEvent().to_sse()

                # Stream progress updates until run_task completes or client disconnects
                while not run_task.done():
                    # Check if client disconnected
                    if disconnect_task.done():
                        print("Client disconnected, cancelling hedge fund execution")
                        run_task.cancel()
                        try:
                            await run_task
                        except asyncio.CancelledError:
                            pass
                        return

                    # Either get a progress update or wait a bit
                    try:
                        event = await asyncio.wait_for(progress_queue.get(), timeout=1.0)
                        yield event.to_sse()
                    except asyncio.TimeoutError:
                        # Just continue the loop
                        pass

                # Get the final result
                try:
                    result = await run_task
                except asyncio.CancelledError:
                    print("Task was cancelled")
                    return

                if not result or not result.get("messages"):
                    yield ErrorEvent(message="Failed to generate hedge fund decisions").to_sse()
                    return

                # Send the final result
                final_data = CompleteEvent(
                    data={
                        "decisions": parse_hedge_fund_response(result.get("messages", [])[-1].content),
                        "analyst_signals": result.get("data", {}).get("analyst_signals", {}),
                        "current_prices": result.get("data", {}).get("current_prices", {}),
                    }
                )
                yield final_data.to_sse()

            except asyncio.CancelledError:
                print("Event generator cancelled")
                return
            finally:
                # Clean up
                progress.unregister_handler(progress_handler)
                if run_task and not run_task.done():
                    run_task.cancel()
                    try:
                        await run_task
                    except asyncio.CancelledError:
                        pass
                if disconnect_task and not disconnect_task.done():
                    disconnect_task.cancel()

        # Return a streaming response
        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred while processing the request: {str(e)}")

@router.post(
    path="/backtest",
    responses={
        200: {"description": "Successful response with streaming backtest updates"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def backtest(request_data: BacktestRequest, request: Request, db: Session = Depends(get_db)):
    """Run a continuous backtest over a time period with streaming updates."""
    try:
        # Hydrate API keys from database if not provided
        if not request_data.api_keys:
            api_key_service = ApiKeyService(db)
            request_data.api_keys = api_key_service.get_api_keys_dict()

        # Convert model_provider to string if it's an enum
        model_provider = request_data.model_provider
        if hasattr(model_provider, "value"):
            model_provider = model_provider.value

        # Create the portfolio (same as /run endpoint)
        portfolio = create_portfolio(
            request_data.initial_capital, 
            request_data.margin_requirement, 
            request_data.tickers, 
            request_data.portfolio_positions
        )

        # Construct agent graph using the React Flow graph structure (same as /run endpoint)
        graph = create_graph(graph_nodes=request_data.graph_nodes, graph_edges=request_data.graph_edges)
        graph = graph.compile()

        # Create backtest service with the compiled graph
        backtest_service = BacktestService(
            graph=graph,
            portfolio=portfolio,
            tickers=request_data.tickers,
            start_date=request_data.start_date,
            end_date=request_data.end_date,
            initial_capital=request_data.initial_capital,
            model_name=request_data.model_name,
            model_provider=model_provider,
            request=request_data,  # Pass the full request for agent-specific model access
        )

        # Function to detect client disconnection
        async def wait_for_disconnect():
            """Wait for client disconnect and return True when it happens"""
            try:
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        return True
            except Exception:
                return True

        # Set up streaming response
        async def event_generator():
            progress_queue = asyncio.Queue()
            backtest_task = None
            disconnect_task = None

            # Global progress handler to capture individual agent updates during backtest
            def progress_handler(agent_name, ticker, status, analysis, timestamp):
                event = ProgressUpdateEvent(agent=agent_name, ticker=ticker, status=status, timestamp=timestamp, analysis=analysis)
                progress_queue.put_nowait(event)

            # Progress callback to handle backtest-specific updates
            def progress_callback(update):
                if update["type"] == "progress":
                    event = ProgressUpdateEvent(
                        agent="backtest",
                        ticker=None,
                        status=f"Processing {update['current_date']} ({update['current_step']}/{update['total_dates']})",
                        timestamp=None,
                        analysis=None
                    )
                    progress_queue.put_nowait(event)
                elif update["type"] == "backtest_result":
                    # Convert day result to a streaming event
                    backtest_result = BacktestDayResult(**update["data"])
                    
                    # Send the full day result data as JSON in the analysis field
                    import json
                    analysis_data = json.dumps(update["data"])
                    
                    event = ProgressUpdateEvent(
                        agent="backtest",
                        ticker=None,
                        status=f"Completed {backtest_result.date} - Portfolio: ${backtest_result.portfolio_value:,.2f}",
                        timestamp=None,
                        analysis=analysis_data
                    )
                    progress_queue.put_nowait(event)

            # Register our handler with the progress tracker to capture agent updates
            progress.register_handler(progress_handler)
            
            try:
                # Start the backtest in a background task
                backtest_task = asyncio.create_task(
                    backtest_service.run_backtest_async(progress_callback=progress_callback)
                )
                
                # Start the disconnect detection task
                disconnect_task = asyncio.create_task(wait_for_disconnect())
                
                # Send initial message
                yield StartEvent().to_sse()

                # Stream progress updates until backtest_task completes or client disconnects
                while not backtest_task.done():
                    # Check if client disconnected
                    if disconnect_task.done():
                        print("Client disconnected, cancelling backtest execution")
                        backtest_task.cancel()
                        try:
                            await backtest_task
                        except asyncio.CancelledError:
                            pass
                        return

                    # Either get a progress update or wait a bit
                    try:
                        event = await asyncio.wait_for(progress_queue.get(), timeout=1.0)
                        yield event.to_sse()
                    except asyncio.TimeoutError:
                        # Just continue the loop
                        pass

                # Get the final result
                try:
                    result = await backtest_task
                except asyncio.CancelledError:
                    print("Backtest task was cancelled")
                    return

                if not result:
                    yield ErrorEvent(message="Failed to complete backtest").to_sse()
                    return

                # Send the final result
                performance_metrics = BacktestPerformanceMetrics(**result["performance_metrics"])
                final_data = CompleteEvent(
                    data={
                        "performance_metrics": performance_metrics.model_dump(),
                        "final_portfolio": result["final_portfolio"],
                        "total_days": len(result["results"]),
                    }
                )
                yield final_data.to_sse()

            except asyncio.CancelledError:
                print("Backtest event generator cancelled")
                return
            finally:
                # Clean up
                progress.unregister_handler(progress_handler)
                if backtest_task and not backtest_task.done():
                    backtest_task.cancel()
                    try:
                        await backtest_task
                    except asyncio.CancelledError:
                        pass
                if disconnect_task and not disconnect_task.done():
                    disconnect_task.cancel()

        # Return a streaming response
        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred while processing the backtest request: {str(e)}")


@router.get(
    path="/agents",
    responses={
        200: {"description": "List of available agents"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def get_agents():
    """Get the list of available agents."""
    try:
        return {"agents": get_agents_list()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve agents: {str(e)}")

