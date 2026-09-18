  // Active positions are display-only in the browser.
  // Position closing, trailing-stop decisions and database updates belong
  // exclusively to Supabase run_virtual_sell_engine().
  const applyPriceUpdatesToTrades = useCallback((
    updatedScans: MarketScan[],
    _currentConfig: BotConfig
  ) => {
    const activeTrades = tradesRef.current;

    if (activeTrades.length === 0) return;

    const updatedTrades: Trade[] = activeTrades.map((trade) => {
      const matchingScan = updatedScans.find(
        (scan) => scan.symbol === trade.symbol
      );

      const livePrice = matchingScan
        ? matchingScan.price
        : trade.current_price;

      const cachedTrend = multiIntervalDataRef.current[trade.symbol];
      const isVolumeDropping = cachedTrend
        ? cachedTrend.volume_dropping_15m
        : false;

      const previousHighest = trade.highest_price || trade.entry_price;
      const liveHighest = Math.max(previousHighest, livePrice);

      // Display-only unrealized value.
      // This does not trigger a sell and does not write to Supabase.
      const grossValue = trade.quantity * livePrice;
      const sellFee = grossValue * 0.001;
      const liveValue = +(grossValue - sellFee).toFixed(2);

      const pnl = +(liveValue - trade.total_amount).toFixed(2);
      const pnlPct = trade.total_amount > 0
        ? +((pnl / trade.total_amount) * 100).toFixed(2)
        : 0;

      return {
        ...trade,
        current_price: livePrice,
        current_value: liveValue,
        unrealized_pnl: pnl,
        unrealized_pnl_percent: pnlPct,
        highest_price: liveHighest,
        is_volume_dropping: isVolumeDropping,
        change_15m: cachedTrend
          ? cachedTrend.change_15m
          : trade.change_15m,
        change_1h: cachedTrend
          ? cachedTrend.change_1h
          : trade.change_1h,
        trend_15m: cachedTrend
          ? cachedTrend.trend_15m
          : trade.trend_15m,
        trend_1h: cachedTrend
          ? cachedTrend.trend_1h
          : trade.trend_1h,
      };
    });

    // Local UI state only. No trades UPDATE, no close decision,
    // no highest_price_reached write and no Supabase mutation.
    setTrades(updatedTrades);
    tradesRef.current = updatedTrades;
  }, []);
