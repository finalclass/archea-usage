package dev.archea.usage;
import android.test.InstrumentationTestCase;
import android.content.Context;
import android.content.Intent;
import android.app.Activity;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetHostView;
import android.content.ComponentName;
import android.view.ViewGroup;
import android.widget.TextView;
import org.json.JSONObject;

public class UsageTest extends InstrumentationTestCase {
    public void testEncryptionRoundTrip() throws Exception {
        Context context=getInstrumentation().getTargetContext();
        String secret="{\"url\":\"https://example.com\",\"username\":\"usage\",\"password\":\"test-secret\"}";
        Secrets.save(context,secret);
        assertEquals(secret,Secrets.read(context));
        assertFalse(context.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("secret","").contains("test-secret"));
    }
    public void testMissingAndZeroReadings() throws Exception {
        JSONObject data=new JSONObject("{\"meters\":[{\"label\":\"GreenPT\",\"windows\":[],\"balance\":null,\"updatedAt\":null,\"stale\":true},{\"label\":\"Codex\",\"windows\":[{\"label\":\"weekly\",\"usedPercent\":0,\"resetsAt\":\"2026-10-08T00:00:00Z\"}],\"balance\":null,\"updatedAt\":\"2026-10-02T00:00:00Z\",\"stale\":false}]} ");
        String text=Api.render(data);
        assertTrue(text.contains("GreenPT: brak danych"));assertTrue(text.contains("weekly 0%"));assertTrue(text.contains("Reset: "));
    }
    public void testSettingsAndWidgetRendering() throws Exception {
        Context context=getInstrumentation().getTargetContext();
        Intent intent=new Intent(context,SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity=getInstrumentation().startActivitySync(intent);
        assertNotNull(activity);
        AppWidgetHost host=new AppWidgetHost(context,99);
        int widgetId=host.allocateAppWidgetId();
        try {
            Secrets.save(context,"{\"url\":\"http://example.com\",\"username\":\"usage\",\"password\":\"test-secret\"}");
            AppWidgetManager manager=AppWidgetManager.getInstance(context);
            assertTrue("Launcher bind permission needed",manager.bindAppWidgetIdIfAllowed(widgetId,new ComponentName(context,UsageWidget.class)));
            // Let the initial widget update complete before installing the rendering fixture.
            Thread.sleep(1000);
            RefreshJob.cancel(context);
            long idleDeadline=android.os.SystemClock.elapsedRealtime()+3000;
            while(RefreshJob.isRefreshing() && android.os.SystemClock.elapsedRealtime()<idleDeadline)Thread.sleep(20);
            assertFalse("Initial refresh stopped",RefreshJob.isRefreshing());
            String snapshot="{\"meters\":["+meter("Grok",79)+","+meter("Codex",80)+","+meter("GreenPT",100)+","+balance()+"]}";
            context.getSharedPreferences("usage",Context.MODE_PRIVATE).edit().putString("snapshot",snapshot).remove("error").commit();
            final AppWidgetHostView[] view=new AppWidgetHostView[1];
            getInstrumentation().runOnMainSync(()->{
                host.startListening();
                view[0]=host.createView(activity,widgetId,manager.getAppWidgetInfo(widgetId));
                activity.setContentView(view[0]);
                UsageWidget.draw(context);
            });
            getInstrumentation().waitForIdleSync();
            Thread.sleep(1000);
            getInstrumentation().runOnMainSync(()->{
                ViewGroup row=view[0].findViewById(R.id.row_one);
                assertEquals(2,row.getChildCount());
                TextView first=row.getChildAt(0).findViewById(R.id.provider_value);
                TextView second=row.getChildAt(1).findViewById(R.id.provider_value);
                assertEquals("79%",first.getText().toString());
                assertEquals("80%",second.getText().toString());
                assertEquals(android.graphics.Color.parseColor("#8ed3ff"),first.getCurrentTextColor());
                assertEquals(android.graphics.Color.parseColor("#ffd166"),second.getCurrentTextColor());
                ViewGroup windows=row.getChildAt(1).findViewById(R.id.windows);
                TextView reset=windows.getChildAt(0).findViewById(R.id.window_reset);
                assertEquals("Tydzień",((TextView)windows.getChildAt(0).findViewById(R.id.window_label)).getText().toString());
                assertTrue(reset.getText().toString().matches("reset · [^,]+, [0-9]{2}:[0-9]{2}"));
                assertEquals(android.graphics.Color.parseColor("#ffd166"),barPixel(row.getChildAt(1),0.05f));
                assertEquals(UsageWidget.TRACK,barPixel(row.getChildAt(1),0.92f));
                ViewGroup rowTwo=view[0].findViewById(R.id.row_two);
                TextView critical=rowTwo.getChildAt(0).findViewById(R.id.provider_value);
                assertEquals("100%",critical.getText().toString());
                assertEquals(android.graphics.Color.parseColor("#ff7078"),critical.getCurrentTextColor());
                assertEquals(android.graphics.Color.parseColor("#ff7078"),barPixel(rowTwo.getChildAt(0),0.92f));
                TextView amount=rowTwo.getChildAt(1).findViewById(R.id.balance_amount);
                TextView currency=rowTwo.getChildAt(1).findViewById(R.id.balance_currency);
                assertEquals(android.view.View.GONE,rowTwo.getChildAt(1).findViewById(R.id.provider_value).getVisibility());
                assertEquals(android.view.View.GONE,rowTwo.getChildAt(1).findViewById(R.id.windows).getVisibility());
                assertEquals(android.view.View.VISIBLE,rowTwo.getChildAt(1).findViewById(R.id.balance_block).getVisibility());
                assertEquals("0.41",amount.getText().toString());
                assertEquals("USD",currency.getText().toString());
                TextView readings=view[0].findViewById(R.id.readings);
                assertTrue(readings.getText().toString().startsWith("Najwyższe zużycie: 100%"));
                assertEquals(android.graphics.Color.parseColor("#ff7078"),readings.getCurrentTextColor());
            });
            assertEquals(Intent.ACTION_VIEW,UsageWidget.websiteIntent().getAction());
            assertEquals("https://szymon.archea.dev",UsageWidget.websiteIntent().getDataString());
            getInstrumentation().runOnMainSync(()->{
                assertFalse("Widget background must not open T3",view[0].findViewById(R.id.widget_root).hasOnClickListeners());
                assertTrue("Title is linked",view[0].findViewById(R.id.title).hasOnClickListeners());
                ViewGroup row=view[0].findViewById(R.id.row_one);
                assertTrue("Provider card is linked",row.getChildAt(0).hasOnClickListeners());
                android.view.View refresh=view[0].findViewById(R.id.refresh);
                assertTrue("Refresh touch target is at least 48dp",refresh.getHeight()>=Math.round(48*context.getResources().getDisplayMetrics().density));
                assertTrue("Refresh is linked",refresh.hasOnClickListeners());
            });
            android.graphics.Bitmap screenshot=getInstrumentation().getUiAutomation().takeScreenshot();
            try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getExternalFilesDir(null),"widget.png"))) {
                screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);
            }
            RefreshJob.cancel(context);
            waitForRefresh(view[0],false,10000);
            // A local invalid URL fails immediately without depending on an external API or connectivity.
            Secrets.save(context,"{\"url\":\"http://example.com\",\"username\":\"usage\",\"password\":\"test-secret\"}");
            getInstrumentation().runOnMainSync(()->assertTrue(view[0].findViewById(R.id.refresh).performClick()));
            waitForRefresh(view[0],true,3000);
            waitForRefresh(view[0],false,10000);
            assertEquals("A failed refresh retains the cards",snapshot,context.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("snapshot",""));
            getInstrumentation().runOnMainSync(()->{
                assertTrue(((TextView)view[0].findViewById(R.id.readings)).getText().toString().startsWith("Nie udało się odświeżyć."));
                assertEquals("Odśwież",((TextView)view[0].findViewById(R.id.refresh_label)).getText().toString());
                assertFalse("Refresh keeps the settings activity open",activity.isFinishing());
            });
        } finally {
            host.deleteAppWidgetId(widgetId);host.stopListening();RefreshJob.cancel(context);
            getInstrumentation().runOnMainSync(activity::finish);
        }
    }
    private void waitForRefresh(AppWidgetHostView view,boolean loading,long timeout) throws Exception {
        long deadline=android.os.SystemClock.elapsedRealtime()+timeout;
        while(android.os.SystemClock.elapsedRealtime()<deadline) {
            final boolean[] matches=new boolean[1];
            getInstrumentation().runOnMainSync(()->{
                boolean visible=view.findViewById(R.id.refresh_progress).getVisibility()==android.view.View.VISIBLE;
                String label=((TextView)view.findViewById(R.id.refresh_label)).getText().toString();
                matches[0]=visible==loading && label.equals(loading?"Odświeżanie…":"Odśwież");
            });
            if(matches[0])return;
            Thread.sleep(20);
        }
        fail("Refresh did not enter "+(loading?"loading":"idle")+" state");
    }
    static String meter(String name,int percent) {
        return "{\"label\":\""+name+"\",\"windows\":[{\"label\":\"weekly\",\"usedPercent\":"+percent+",\"resetsAt\":\"2026-10-07T07:51:00Z\"}],\"balance\":null,\"updatedAt\":\"2026-10-02T00:00:00Z\",\"stale\":false}";
    }
    static String balance() {
        return "{\"label\":\"OpenRouter\",\"windows\":[],\"balance\":{\"amount\":0.41,\"currency\":\"USD\"},\"updatedAt\":\"2026-10-02T00:00:00Z\",\"stale\":false}";
    }
    static int barPixel(android.view.View card,float fraction) {
        android.view.ViewGroup windows=card.findViewById(R.id.windows);
        android.widget.ImageView meter=windows.getChildAt(0).findViewById(R.id.meter);
        android.graphics.Bitmap bitmap=((android.graphics.drawable.BitmapDrawable)meter.getDrawable()).getBitmap();
        int x=Math.max(0,Math.min(bitmap.getWidth()-1,Math.round((bitmap.getWidth()-1)*fraction)));
        return bitmap.getPixel(x,bitmap.getHeight()/2);
    }
    public void testThresholdsAndResetFormat() throws Exception {
        for(int p:new int[]{0,79,80,99,100,101})assertEquals(p>=100?2:p>=80?1:0,Api.level(new JSONObject(meter("Codex",p))));
        assertEquals("10.2%",Api.percentLabel(10.24));
        assertEquals("80%",Api.percentLabel(80));
        assertEquals("Abonament",Api.windowLabel("subscription"));
        assertEquals("5 h",Api.windowLabel("5h"));
        java.util.TimeZone previous=java.util.TimeZone.getDefault();
        try {
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
            assertEquals("środa, 07:51",Api.resetLabel(java.time.Instant.parse("2026-10-07T07:51:00Z")));
            org.json.JSONArray meters=new org.json.JSONObject("{\"meters\":[{\"label\":\"Grok\",\"windows\":[{\"label\":\"subscription\",\"usedPercent\":10.24,\"resetsAt\":null}],\"balance\":null,\"updatedAt\":\"2026-10-04T05:04:00Z\",\"stale\":false}]}").getJSONArray("meters");
            assertEquals("Najwyższe zużycie: 10% · stan 05:04",Api.summary(meters));
            assertEquals(0,Api.worstLevel(new org.json.JSONArray("["+balance()+"]")));
            android.graphics.Bitmap low=UsageWidget.meterBitmap(100,8,UsageWidget.ACCENT,2);
            android.graphics.Bitmap high=UsageWidget.meterBitmap(100,8,UsageWidget.ACCENT,12);
            assertEquals(UsageWidget.ACCENT,low.getPixel(2,4));
            assertEquals(UsageWidget.TRACK,low.getPixel(30,4));
            assertEquals(UsageWidget.ACCENT,high.getPixel(8,4));
            assertEquals(UsageWidget.TRACK,high.getPixel(30,4));
            assertEquals(UsageWidget.TRACK,UsageWidget.meterBitmap(100,8,UsageWidget.ACCENT,0).getPixel(2,4));
            assertEquals(UsageWidget.WARNING,UsageWidget.meterBitmap(100,8,UsageWidget.WARNING,80).getPixel(40,4));
            assertEquals(UsageWidget.TRACK,UsageWidget.meterBitmap(100,8,UsageWidget.WARNING,80).getPixel(92,4));
            assertEquals(UsageWidget.CRITICAL,UsageWidget.meterBitmap(100,8,UsageWidget.CRITICAL,100).getPixel(96,4));
        }
        finally { java.util.TimeZone.setDefault(previous); }
    }
}
