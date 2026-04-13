# Compose는 라이브러리 자체에 consumer rules가 들어있어 추가 설정 거의 불필요.

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keep,includedescriptorclasses class kr.konempty.quietlounge.**$$serializer { *; }
-keepclassmembers class kr.konempty.quietlounge.** {
    *** Companion;
}
-keepclasseswithmembers class kr.konempty.quietlounge.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# JavascriptInterface — minify 시 메서드 이름이 사라지면 WebView에서 호출 불가
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep public class kr.konempty.quietlounge.webview.NativeBridge { *; }

# WebView 표준
-keep class * extends android.webkit.WebViewClient
-keep class * extends android.webkit.WebChromeClient

# 경고 억제
-dontwarn java.lang.invoke.StringConcatFactory
-dontwarn org.jetbrains.annotations.**
