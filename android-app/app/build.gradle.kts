import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    jacoco
}

jacoco {
    toolVersion = "0.8.12"
}

// release.keystore.properties (gitignore) — CI/local에서 서명용
val keystorePropertiesFile = rootProject.file("release.keystore.properties")
val keystoreProperties =
    Properties().apply {
        if (keystorePropertiesFile.exists()) load(keystorePropertiesFile.inputStream())
    }

android {
    namespace = "kr.konempty.quietlounge"
    compileSdk = 36

    defaultConfig {
        applicationId = "kr.konempty.quietlounge"
        minSdk = 24
        targetSdk = 36
        versionCode = 5
        versionName = "1.0.2"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    signingConfigs {
        create("release") {
            if (keystoreProperties.isNotEmpty()) {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile") ?: "release.keystore")
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // 네이티브 디버그 심볼을 AAB에 포함 — Play Console 크래시 분석용
            ndk { debugSymbolLevel = "FULL" }
            // keystore 설정이 있으면 서명, 없으면 unsigned
            if (keystoreProperties.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        getByName("debug") {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            enableUnitTestCoverage = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // minSdk 24 에서 java.time.*, java.nio.file 등 JDK 8+ API 를 사용 가능하게 함.
        // 활성화 안 하면 `Instant.now()`, `OffsetDateTime.parse()` 등이 API 24~25 에서
        // NoClassDefFoundError 로 크래시 → AndroidLintNewApi ERROR 해소용.
        isCoreLibraryDesugaringEnabled = true
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            // Robolectric 에서 Android 리소스/매니페스트를 사용 가능하게 함
            // 주의: Robolectric 의 SandboxClassLoader 가 JaCoCo online 에이전트와
            // 격리돼 Compose UI 테스트 실행분은 JaCoCo 리포트에 반영되지 않는다.
            // 테스트 자체는 실행되고 회귀를 잡지만, 커버리지 수치상은 0 으로 보인다.
            isIncludeAndroidResources = true
        }
    }

    packaging {
        resources {
            excludes +=
                setOf(
                    "META-INF/AL2.0",
                    "META-INF/LGPL2.1",
                    "META-INF/{INDEX.LIST,DEPENDENCIES,LICENSE,LICENSE.txt,NOTICE,NOTICE.txt}",
                )
        }
    }

    // bundle 빌드 (AAB) 시 ABI/언어/밀도 split → Play Store가 사용자 단말에 맞게 분배
    bundle {
        language { enableSplit = true }
        density { enableSplit = true }
        abi { enableSplit = true }
    }
}

// AGP 9.0+ — kotlinOptions deprecated, kotlin { compilerOptions { ... } } 사용
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    coreLibraryDesugaring(libs.desugar.jdk.libs)

    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.activity.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.navigation.compose)
    implementation(libs.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // Compose UI 테스트 — Robolectric 위에서 JVM 실행 (에뮬레이터 불필요)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core.ktx)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    // createComposeRule 이 사용할 임시 Activity — debug 매니페스트로 주입
    debugImplementation(libs.compose.ui.test.manifest)
}

// ── JaCoCo 커버리지 리포트 ──────────────────────────────────────
// 실행: ./gradlew :app:jacocoTestReport
// 결과: app/build/reports/jacoco/jacocoTestReport/html/index.html
tasks.register<JacocoReport>("jacocoTestReport") {
    dependsOn("testDebugUnitTest")
    reports {
        html.required.set(true)
        xml.required.set(true)
    }
    val fileFilter =
        listOf(
            "**/R.class",
            "**/R\$*.class",
            "**/BuildConfig.*",
            "**/Manifest*.*",
            "**/*Test*.*",
            "android/**/*.*",
            "**/*_Factory.*",
            "**/*_Impl.*",
            // Compose 내부 생성물
            "**/ComposableSingletons*.*",
            "**/*ScreenKt*.*",
            "**/*ScreenPreviewKt*.*",
        )
    val kotlinDebugClasses =
        fileTree(
            "${layout.buildDirectory.get()}/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes",
        ) { exclude(fileFilter) }
    val javaDebugClasses =
        fileTree(
            "${layout.buildDirectory.get()}/intermediates/javac/debug/compileDebugJavaWithJavac/classes",
        ) { exclude(fileFilter) }
    classDirectories.setFrom(kotlinDebugClasses, javaDebugClasses)
    sourceDirectories.setFrom(files("src/main/kotlin"))
    executionData.setFrom(
        fileTree(layout.buildDirectory) {
            include("outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec")
        },
    )
}
