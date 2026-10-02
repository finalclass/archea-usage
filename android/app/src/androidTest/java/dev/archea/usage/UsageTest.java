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
            AppWidgetManager manager=AppWidgetManager.getInstance(context);
            assertTrue("Launcher bind permission needed",manager.bindAppWidgetIdIfAllowed(widgetId,new ComponentName(context,UsageWidget.class)));
            String snapshot="{\"meters\":["+meter("Grok",79)+","+meter("Codex",80)+","+meter("GreenPT",100)+","+meter("OpenRouter",0)+"]}";
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
                assertTrue(first.getText().toString().contains("79%"));
                assertTrue(second.getText().toString().contains("80%"));
                assertTrue(second.getText().toString().matches("(?s).*Reset: [^,]+, [0-9]{2}:[0-9]{2}.*"));
                assertEquals(android.graphics.Color.parseColor("#ffd166"),second.getCurrentTextColor());
                ViewGroup rowTwo=view[0].findViewById(R.id.row_two);
                TextView critical=rowTwo.getChildAt(0).findViewById(R.id.provider_value);
                assertTrue(critical.getText().toString().contains("100%"));
                assertEquals(android.graphics.Color.parseColor("#ff7078"),critical.getCurrentTextColor());
            });
            assertEquals(Intent.ACTION_VIEW,UsageWidget.websiteIntent().getAction());
            assertEquals("https://szymon.archea.dev",UsageWidget.websiteIntent().getDataString());
            getInstrumentation().runOnMainSync(()->{
                assertTrue("Title is linked",view[0].findViewById(R.id.title).hasOnClickListeners());
                ViewGroup row=view[0].findViewById(R.id.row_one);
                assertTrue("Provider card is linked",row.getChildAt(0).hasOnClickListeners());
            });
            android.graphics.Bitmap screenshot=getInstrumentation().getUiAutomation().takeScreenshot();
            try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getExternalFilesDir(null),"widget.png"))) {
                screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);
            }
        } finally {
            host.deleteAppWidgetId(widgetId);host.stopListening();RefreshJob.cancel(context);
            getInstrumentation().runOnMainSync(activity::finish);
        }
    }
    static String meter(String name,int percent) {
        return "{\"label\":\""+name+"\",\"windows\":[{\"label\":\"weekly\",\"usedPercent\":"+percent+",\"resetsAt\":\"2026-10-07T07:51:00Z\"}],\"balance\":null,\"updatedAt\":\"2026-10-02T00:00:00Z\",\"stale\":false}";
    }
    public void testThresholdsAndResetFormat() throws Exception {
        for(int p:new int[]{0,79,80,99,100,101})assertEquals(p>=100?2:p>=80?1:0,Api.level(new JSONObject(meter("Codex",p))));
        java.util.TimeZone previous=java.util.TimeZone.getDefault();
        try { java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));assertEquals("środa, 07:51",Api.resetLabel(java.time.Instant.parse("2026-10-07T07:51:00Z"))); }
        finally { java.util.TimeZone.setDefault(previous); }
    }
}
