package dev.archea.usage;
import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.widget.LinearLayout;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Button;
import android.widget.ScrollView;
import org.json.JSONObject;
import java.net.URI;

public class SettingsActivity extends Activity {
    private EditText url,user,password;
    private TextView status;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll=new ScrollView(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(24,48,24,24);scroll.addView(layout);setContentView(scroll);
        TextView title=new TextView(this);title.setText("Archea Usage\nSkonfiguruj API, potem dodaj widget na ekran główny.\nAutomatyczne odświeżanie około 15 minut; przycisk widgetu odświeża na żądanie.");layout.addView(title);
        url=field(layout,"Adres HTTPS API");url.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);url.setText("https://usage.szymon.archea.dev");
        user=field(layout,"Login Basic Auth");user.setText("usage");
        password=field(layout,"Hasło Basic Auth");password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        try {String saved=Secrets.read(this);if(!saved.isEmpty()){JSONObject c=new JSONObject(saved);url.setText(c.getString("url"));user.setText(c.getString("username"));password.setText(c.getString("password"));}}catch(Exception ignored){}
        Button save=new Button(this);save.setText("Zapisz i sprawdź połączenie");layout.addView(save);
        status=new TextView(this);layout.addView(status);
        save.setOnClickListener(v->{
            try {
                String address=url.getText().toString().trim().replaceAll("/+$","");URI parsed=new URI(address);
                if(!"https".equals(parsed.getScheme())||parsed.getHost()==null||parsed.getUserInfo()!=null||parsed.getQuery()!=null||parsed.getFragment()!=null||!parsed.getPath().isEmpty())throw new Exception("Adres musi być adresem HTTPS bez ścieżki");
                if(user.getText().toString().isEmpty()||user.getText().toString().contains(":" )||password.getText().toString().isEmpty())throw new Exception("Wpisz login i hasło");
                JSONObject c=new JSONObject().put("url",address).put("username",user.getText().toString()).put("password",password.getText().toString());Secrets.save(this,c.toString());
                status.setText("Sprawdzanie…");save.setEnabled(false);
                new Thread(()->{String message;try{message=Api.render(Api.fetch(this));getSharedPreferences("usage",MODE_PRIVATE).edit().putString("readings",message).remove("error").commit();UsageWidget.draw(this);RefreshJob.schedule(this);}catch(Exception e){message="Nie udało się połączyć. Sprawdź adres, login i hasło.";}final String result=message;runOnUiThread(()->{status.setText(result);save.setEnabled(true);});}).start();
            } catch(Exception e) {status.setText(e.getMessage());}
        });
    }
    private EditText field(LinearLayout layout,String hint){EditText e=new EditText(this);e.setHint(hint);e.setSingleLine(true);e.setSaveEnabled(false);layout.addView(e);return e;}
}
