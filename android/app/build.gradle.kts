plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.remindo.widget"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.remindo.widget"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    signingConfigs {
        // A fixed key in the repo so each new build installs over the previous one.
        // It only signs this personal widget app.
        create("fixed") {
            storeFile = file("remindo-widget.keystore")
            storePassword = "remindo-widget"
            keyAlias = "remindo"
            keyPassword = "remindo-widget"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("fixed")
        }
        debug {
            signingConfig = signingConfigs.getByName("fixed")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
