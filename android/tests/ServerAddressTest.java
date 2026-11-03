import app.volna.messenger.ServerAddress;

public class ServerAddressTest {
    private static void check(boolean condition){if(!condition)throw new AssertionError();}
    public static void main(String[] args){
        check(ServerAddress.normalize(" HTTP://192.168.0.19:8787/ ").equals("http://192.168.0.19:8787"));
        for(String value:new String[]{"http://10.0.2.2:8787","http://172.16.4.2:8787","http://pc.local:8787","https://example.com"})check(!ServerAddress.normalize(value).isEmpty());
        for(String value:new String[]{"http://example.com","http://172.32.0.1","file:///sdcard/test.html","javascript:alert(1)","https://user:password@example.com","https://example.com/path","https://example.com?token=x","http://192.168.0.256","https://example.com:70000","https://example.com:0"}){
            boolean rejected=false;try{ServerAddress.normalize(value);}catch(IllegalArgumentException expected){rejected=true;}check(rejected);
        }
        check(ServerAddress.sameOrigin("https://example.com","https://EXAMPLE.com:443/api/chats"));
        check(!ServerAddress.sameOrigin("http://192.168.0.19:8787","http://192.168.0.19:8888/"));
        check(!ServerAddress.sameOrigin("https://example.com","https://example.com.evil.test/"));
        check(!ServerAddress.sameOrigin("https://example.com","http://example.com/"));
        check(!ServerAddress.sameOrigin("https://example.com","https://user:pass@example.com/"));
        System.out.println("Server URL and origin policy tests passed");
    }
}
