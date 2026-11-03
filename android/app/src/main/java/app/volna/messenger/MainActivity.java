package app.volna.messenger;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int BG = Color.rgb(11,17,27), MINT = Color.rgb(157,240,206);
    private static final String DEFAULT_SERVER = "http://192.168.0.19:8787";
    private SharedPreferences preferences;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView webView;
    private String server;
    private boolean loading = false;
    private int generation = 0;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("volna", MODE_PRIVATE);
        server = preferences.getString("server", DEFAULT_SERVER);
        if (preferences.getBoolean("connected", false)) connect(server);
        else showSetup(null);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setLineSpacing(dp(4),1); return view;
    }
    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable;
    }
    private Button button(String title) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false);
        button.setTextColor(BG); button.setBackground(rounded(MINT,16)); button.setMinHeight(dp(52)); return button;
    }
    private void installRoot(View root) {
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root); root.requestApplyInsets();
    }
    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading();
        if (webView.getParent() instanceof ViewGroup) ((ViewGroup)webView.getParent()).removeView(webView);
        webView.destroy(); webView = null;
    }

    private void showSetup(String problem) {
        generation++; destroyWebView(); loading = false;
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(28),dp(36),dp(28),dp(28));
        scroll.addView(page); root.addView(scroll,new LinearLayout.LayoutParams(-1,-1));
        TextView logo = text("≈",64,MINT); logo.setTypeface(null,Typeface.BOLD); page.addView(logo);
        TextView title = text("Волна",38,Color.WHITE); title.setTypeface(null,Typeface.BOLD); page.addView(title);
        TextView subtitle = text("Ближе, чем кажется.",18,Color.rgb(139,158,171)); page.addView(subtitle);
        TextView label = text("АДРЕС ВАШЕГО СЕРВЕРА",11,MINT);
        LinearLayout.LayoutParams labelLayout = new LinearLayout.LayoutParams(-1,-2); labelLayout.topMargin=dp(40); labelLayout.bottomMargin=dp(12);page.addView(label,labelLayout);
        EditText address = new EditText(this); address.setText(server); address.setSingleLine(true);
        address.setTextColor(Color.WHITE); address.setTextSize(15);address.setPadding(dp(15),dp(16),dp(15),dp(16));
        address.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); address.setBackground(rounded(Color.rgb(23,33,46),14));page.addView(address);
        TextView help = text("Телефон и ПК должны быть в одной сети Wi-Fi. Запустите сервер «Волна» на ПК и введите его адрес. Для сервера в интернете используйте HTTPS.",13,Color.rgb(133,147,159));
        LinearLayout.LayoutParams helpLayout = new LinearLayout.LayoutParams(-1,-2);helpLayout.topMargin=dp(16);page.addView(help,helpLayout);
        TextView error = text(problem == null ? "" : problem,13,Color.rgb(255,190,157));
        LinearLayout.LayoutParams errorLayout = new LinearLayout.LayoutParams(-1,-2);errorLayout.topMargin=dp(18);page.addView(error,errorLayout);
        Button submit = button("Подключиться");LinearLayout.LayoutParams submitLayout = new LinearLayout.LayoutParams(-1,dp(54));submitLayout.topMargin=dp(20);page.addView(submit,submitLayout);
        TextView detail = text("Android-версия использует интерфейс мессенджера внутри приложения. Аккаунты и переписка общие с iPhone. Без звонков, push-уведомлений и сквозного шифрования. В локальной сети используется HTTP.",12,Color.rgb(112,133,148));
        LinearLayout.LayoutParams detailLayout = new LinearLayout.LayoutParams(-1,-2);detailLayout.topMargin=dp(28);page.addView(detail,detailLayout);
        final int current = generation;
        submit.setOnClickListener(view -> {
            if (loading) return;
            final String candidate;
            try { candidate = ServerAddress.normalize(address.getText().toString()); }
            catch (IllegalArgumentException failure) { error.setText(failure.getMessage());return; }
            loading=true;submit.setEnabled(false);submit.setText("Проверяем сервер…");error.setText("");
            network.execute(() -> {
                String failure = null;
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection)new URL(candidate+"/health").openConnection();
                    connection.setConnectTimeout(8000);connection.setReadTimeout(8000);connection.setInstanceFollowRedirects(false);
                    if (connection.getResponseCode()!=200) throw new Exception();
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    try (InputStream input = connection.getInputStream()) {
                        byte[] chunk=new byte[1024]; int count;
                        while ((count=input.read(chunk))!=-1) {
                            bytes.write(chunk,0,count);
                            if(bytes.size()>8192)throw new Exception();
                        }
                    }
                    JSONObject result = new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
                    if (!result.optBoolean("ok") || !"Volna".equals(result.optString("app"))) throw new Exception();
                } catch (Exception unavailable) { failure="Нет связи с сервером. Проверьте адрес, Wi-Fi и запущен ли сервер на ПК."; }
                finally { if(connection!=null)connection.disconnect(); }
                final String message=failure;
                main.post(() -> {
                    if (isFinishing() || current!=generation)return;
                    loading=false;submit.setEnabled(true);submit.setText("Подключиться");
                    if(message!=null){error.setText(message);return;}
                    InputMethodManager keyboard=(InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
                    if(keyboard!=null)keyboard.hideSoftInputFromWindow(address.getWindowToken(),0);
                    preferences.edit().putString("server",candidate).putBoolean("connected",true).apply();
                    server=candidate;connect(candidate);
                });
            });
        });
        installRoot(root);
    }

    private void connect(String candidate) {
        try { server=ServerAddress.normalize(candidate); }
        catch(IllegalArgumentException failure){showSetup(failure.getMessage());return;}
        generation++;destroyWebView();final int current=generation;
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar=new LinearLayout(this);toolbar.setGravity(Gravity.CENTER_VERTICAL);toolbar.setPadding(dp(14),dp(4),dp(10),dp(4));
        TextView brand=text("≈  ВОЛНА",12,MINT);brand.setTypeface(null,Typeface.BOLD);toolbar.addView(brand,new LinearLayout.LayoutParams(0,dp(36),1));brand.setGravity(Gravity.CENTER_VERTICAL);
        Button settings=new Button(this);settings.setText("Сервер");settings.setAllCaps(false);settings.setTextColor(MINT);settings.setTextSize(12);settings.setBackgroundColor(Color.TRANSPARENT);toolbar.addView(settings,new LinearLayout.LayoutParams(dp(88),dp(40)));settings.setOnClickListener(view -> showSetup(null));
        root.addView(toolbar,new LinearLayout.LayoutParams(-1,-2));
        ProgressBar progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(2)));
        webView=new WebView(this);webView.setBackgroundColor(BG);root.addView(webView,new LinearLayout.LayoutParams(-1,0,1));
        WebSettings options=webView.getSettings();options.setJavaScriptEnabled(true);options.setDomStorageEnabled(true);
        options.setAllowFileAccess(false);options.setAllowContentAccess(false);options.setGeolocationEnabled(false);
        options.setJavaScriptCanOpenWindowsAutomatically(false);options.setSupportMultipleWindows(false);
        options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);options.setSafeBrowsingEnabled(true);
        options.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView,false);
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);progress.setVisibility(value==100?View.GONE:View.VISIBLE);}
        });
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !ServerAddress.sameOrigin(server,request.getUrl().toString());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(ServerAddress.sameOrigin(server,request.getUrl().toString()))return null;
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(request.isForMainFrame())main.post(() -> {if(current==generation)showSetup("Не удалось загрузить мессенджер. Проверьте сервер и подключитесь снова.");});
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
                if(request.isForMainFrame())main.post(() -> {if(current==generation)showSetup("Сервер вернул ошибку "+response.getStatusCode()+". Проверьте адрес.");});
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){
                handler.cancel();main.post(() -> {if(current==generation)showSetup("Ошибка сертификата HTTPS. Используйте сервер с действительным сертификатом.");});
            }
        });
        installRoot(root);webView.loadUrl(server+"/");
    }

    @Override public void onBackPressed(){
        if(webView!=null){
            // The hosted client is a single-page app; close its selected chat before exiting.
            webView.evaluateJavascript("(function(){var b=document.querySelector('.back');if(b&&getComputedStyle(b).display!=='none'){b.click();return true;}return false;})()",result -> {if(!"true".equals(result))MainActivity.super.onBackPressed();});
        } else super.onBackPressed();
    }
    @Override protected void onPause(){if(webView!=null)webView.onPause();super.onPause();}
    @Override protected void onResume(){super.onResume();if(webView!=null)webView.onResume();}
    @Override protected void onDestroy(){generation++;destroyWebView();network.shutdownNow();super.onDestroy();}
}
