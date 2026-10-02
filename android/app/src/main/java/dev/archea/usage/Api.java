package dev.archea.usage;
import android.content.Context;
import android.util.Base64;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

final class Api {
    static JSONObject fetch(Context c) throws Exception {
        JSONObject config = new JSONObject(Secrets.read(c));
        URL url = new URL(config.getString("url") + "/v1/usage");
        if (!url.getProtocol().equals("https") || url.getUserInfo() != null) throw new Exception("HTTPS required");
        HttpsURLConnection conn = (HttpsURLConnection)url.openConnection();
        conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(10000); conn.setReadTimeout(10000);
        String credentials = config.getString("username") + ":" + config.getString("password");
        conn.setRequestProperty("Authorization", "Basic " + Base64.encodeToString(credentials.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        try {
            if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] chunk = new byte[4096]; int count;
                while ((count=in.read(chunk)) != -1) { out.write(chunk,0,count); if(out.size()>262144)throw new Exception("Response too large"); }
                JSONObject data = new JSONObject(out.toString("UTF-8"));
                if(data.getInt("version")!=1)throw new Exception("Unsupported API");
                return data;
            }
        } finally { conn.disconnect(); }
    }
    static String resetLabel(Instant date) {
        return DateTimeFormatter.ofPattern("EEEE, HH:mm",java.util.Locale.forLanguageTag("pl-PL")).withZone(ZoneId.systemDefault()).format(date);
    }
    static int level(JSONObject meter) throws Exception {
        JSONArray windows=meter.getJSONArray("windows"); double peak=0;
        for(int i=0;i<windows.length();i++) peak=Math.max(peak,windows.getJSONObject(i).getDouble("usedPercent"));
        return peak>=100 ? 2 : peak>=80 ? 1 : 0;
    }
    static String cardText(JSONObject m) throws Exception {
        StringBuilder result=new StringBuilder();JSONArray windows=m.getJSONArray("windows");
        for(int i=0;i<windows.length();i++) {
            JSONObject w=windows.getJSONObject(i);if(i>0)result.append("\n");
            String label=w.getString("label");if(label.equals("weekly"))label="Tydzień";if(label.equals("subscription"))label="Abonament";
            result.append(label).append(": ").append(Math.round(w.getDouble("usedPercent"))).append("% zużyte");
            result.append("\n").append(w.isNull("resetsAt") ? "Brak daty resetu" : "Reset: "+resetLabel(Instant.parse(w.getString("resetsAt"))));
        }
        if(!m.isNull("balance")) { JSONObject b=m.getJSONObject("balance");result.append(String.format(java.util.Locale.ROOT,"%.2f %s pozostało",b.getDouble("amount"),b.getString("currency"))); }
        if(result.length()==0)result.append("Brak danych");
        if(m.optBoolean("stale"))result.append("\nDane nieaktualne");
        return result.toString();
    }
    static String render(JSONObject data) throws Exception {
        StringBuilder result = new StringBuilder(); JSONArray meters = data.getJSONArray("meters");
        for (int i=0;i<meters.length();i++) {
            JSONObject m=meters.getJSONObject(i); result.append(m.getString("label")).append(": ");
            JSONArray windows=m.getJSONArray("windows");
            for(int j=0;j<windows.length();j++) {
                JSONObject w=windows.getJSONObject(j);
                if(j>0)result.append("\n  ");
                result.append(w.getString("label")).append(" ").append(Math.round(w.getDouble("usedPercent"))).append("% zużyte");
                if(!w.isNull("resetsAt")) {
                    Instant reset=Instant.parse(w.getString("resetsAt"));
                    result.append("\n  Reset: ").append(resetLabel(reset));
                }
            }
            if(!m.isNull("balance")){JSONObject b=m.getJSONObject("balance");result.append(String.format(java.util.Locale.ROOT,"%.2f %s",b.getDouble("amount"),b.getString("currency")));}
            if(windows.length()==0 && m.isNull("balance"))result.append("brak danych");
            if(m.optBoolean("stale"))result.append(" · nieaktualne");
            if(!m.isNull("updatedAt"))result.append("\n  stan: ").append(DateTimeFormatter.ofPattern("dd.MM HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(m.getString("updatedAt"))));
            result.append("\n\n");
        }
        return result.toString().trim();
    }
}
