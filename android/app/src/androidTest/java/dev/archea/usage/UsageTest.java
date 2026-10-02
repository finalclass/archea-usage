package dev.archea.usage;
import android.test.InstrumentationTestCase;
import android.content.Context;
import android.content.Intent;
import android.app.Activity;
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
        Intent intent=new Intent(getInstrumentation().getTargetContext(),SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity=getInstrumentation().startActivitySync(intent);
        assertNotNull(activity);
        getInstrumentation().runOnMainSync(()->UsageWidget.draw(getInstrumentation().getTargetContext()));
        getInstrumentation().runOnMainSync(activity::finish);
    }
}
