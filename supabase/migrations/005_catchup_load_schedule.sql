-- GitHub Actions often starts the scheduled scrapers hours late. Load and notify again every hour
-- from 10:12 to 21:12 Pakistan time, so fresh data reaches the app soon after it lands.
select cron.schedule('arzish-catchup', '12 5-16 * * *', $$select public.invoke_function('jobs/morning')$$);
