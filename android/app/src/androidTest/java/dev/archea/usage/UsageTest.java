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
        assertTrue(text.contains("GreenPT: brak danych"));assertTrue(text.contains("weekly 0%"));assertTrue(text.contains("reset za"));
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
            context.getSharedPreferences("usage",Context.MODE_PRIVATE).edit().putString("readings","Codex: weekly 54% zużyte").remove("error").commit();
            final AppWidgetHostView[] view=new AppWidgetHostView[1];
            getInstrumentation().runOnMainSync(()->{
                host.startListening();
                view[0]=host.createView(activity,widgetId,manager.getAppWidgetInfo(widgetId));
                ((ViewGroup)activity.findViewById(android.R.id.content)).addView(view[0]);
                UsageWidget.draw(context);
            });
            getInstrumentation().waitForIdleSync();
            Thread.sleep(1000);
            final String[] displayed=new String[1];
            getInstrumentation().runOnMainSync(()->{
                TextView readings=view[0].findViewById(R.id.readings);
                displayed[0]=readings==null ? null : readings.getText().toString();
            });
            assertNotNull("RemoteViews inflated",displayed[0]);
            assertTrue("Reading visible: "+displayed[0],displayed[0].contains("54%"));
        } finally {
            host.deleteAppWidgetId(widgetId);host.stopListening();RefreshJob.cancel(context);
            getInstrumentation().runOnMainSync(activity::finish);
        }
    }
}
