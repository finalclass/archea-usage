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
import java.util.Locale;

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
    static int percentLevel(double percent) { return percent>=100 ? 2 : percent>=80 ? 1 : 0; }
    static int level(JSONObject meter) throws Exception {
        JSONArray windows=meter.getJSONArray("windows"); double peak=0;
        for(int i=0;i<windows.length();i++) peak=Math.max(peak,windows.getJSONObject(i).getDouble("usedPercent"));
        return percentLevel(peak);
    }
    static int worstLevel(JSONArray meters) throws Exception {
        double peak=-1;
        for(int i=0;i<meters.length();i++) {
            JSONArray windows=meters.getJSONObject(i).getJSONArray("windows");
            for(int j=0;j<windows.length();j++) peak=Math.max(peak,windows.getJSONObject(j).getDouble("usedPercent"));
        }
        return peak<0 ? 0 : percentLevel(peak);
    }
    static String windowLabel(String label) {
        if("weekly".equals(label)) return "Tydzień";
        if("subscription".equals(label)) return "Abonament";
        if("5h".equals(label)) return "5 h";
        return label;
    }
    static String percentLabel(double percent) {
        double rounded=Math.round(percent*10.0)/10.0;
        if(Math.abs(rounded-Math.rint(rounded))<0.001) return ((long)Math.rint(rounded))+"%";
        return String.format(java.util.Locale.ROOT,"%.1f%%",rounded);
    }
    static String clock(Instant date) {
        return DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(date);
    }
    static String money(double amount) {
        if (amount == 0d) return "0.00";
        if (Math.abs(amount) >= 0.01d) return String.format(Locale.ROOT, "%.2f", amount);
        return String.format(Locale.ROOT, "%.8f", amount).replaceAll("0+$", "").replaceAll("\\.$", "");
    }
    static String errorLabel(String error) {
        if (error == null || error.isEmpty()) return null;
        if ("provider_http_401".equals(error)) return "odrzucony klucz";
        if ("provider_http_402".equals(error)) return "brak środków";
        if ("provider_http_429".equals(error)) return "limit zapytań";
        if ("invalid_response".equals(error)) return "niepoprawny pomiar";
        if ("provider_unavailable".equals(error)) return "awaria sieci";
        if ("login_required".equals(error)) return "brak logowania";
        if ("credentials_missing".equals(error)) return "brak klucza";
        if (error.matches("provider_http_\\d{3}")) return "błąd dostawcy";
        return "błąd pomiaru";
    }
    static String periodLabel(Instant from, Instant until) {
        DateTimeFormatter format = DateTimeFormatter.ofPattern("dd.MM").withZone(ZoneId.systemDefault());
        return format.format(from) + "–" + format.format(until);
    }
    static String statusLine(JSONObject meter) throws Exception {
        StringBuilder parts = new StringBuilder();
        if (meter.optBoolean("stale")) parts.append("nieaktualne · ");
        if (!meter.isNull("error")) {
            String label = errorLabel(meter.getString("error"));
            if (label != null) parts.append(label).append(" · ");
        }
        String updated = meter.isNull("updatedAt") ? "—" : clock(Instant.parse(meter.getString("updatedAt")));
        parts.append("stan ").append(updated);
        return parts.toString();
    }
    static String summary(JSONArray meters) throws Exception {
        Double worst=null; Instant latest=null;
        for(int i=0;i<meters.length();i++) {
            JSONObject meter=meters.getJSONObject(i);
            JSONArray windows=meter.getJSONArray("windows");
            for(int j=0;j<windows.length();j++) {
                double percent=windows.getJSONObject(j).getDouble("usedPercent");
                if(worst==null || percent>worst) worst=percent;
            }
            if(!meter.isNull("updatedAt")) {
                Instant time=Instant.parse(meter.getString("updatedAt"));
                if(latest==null || time.isAfter(latest)) latest=time;
            }
        }
        StringBuilder parts=new StringBuilder();
        if(worst!=null) parts.append("Najwyższe zużycie: ").append(Math.round(worst)).append("%");
        if(latest!=null) {
            if(parts.length()>0) parts.append(" · stan ");
            else parts.append("Stan ");
            parts.append(clock(latest));
        }
        return parts.toString();
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
            if(!m.isNull("balance")){JSONObject b=m.getJSONObject("balance");result.append(money(b.getDouble("amount"))).append(" ").append(b.getString("currency"));}
            if(!m.isNull("spend")){
                JSONObject spend=m.getJSONObject("spend");
                result.append("\n  ").append(money(spend.getDouble("amount"))).append(" ").append(spend.getString("currency"));
                if(!spend.isNull("from") && !spend.isNull("until")) result.append(" · ").append(periodLabel(Instant.parse(spend.getString("from")), Instant.parse(spend.getString("until"))));
            }
            if(windows.length()==0 && m.isNull("balance"))result.append("brak danych");
            if(m.optBoolean("stale"))result.append(" · nieaktualne");
            if(!m.isNull("error")){String label=errorLabel(m.getString("error")); if(label!=null) result.append(" · ").append(label);}
            if(!m.isNull("updatedAt"))result.append("\n  stan: ").append(DateTimeFormatter.ofPattern("dd.MM HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(m.getString("updatedAt"))));
            result.append("\n\n");
        }
        return result.toString().trim();
    }
}
