use std::{
    env, fs,
    path::{Path, PathBuf},
};
fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).expect("Cubism Framework source directory") {
        let p = e.unwrap().path();
        if p.is_dir() {
            if p.file_name().unwrap() == "Rendering" {
                continue;
            }
            collect(&p, out);
        } else if p.extension().is_some_and(|x| x == "cpp") {
            out.push(p);
        }
    }
}
fn main() {
    let home = env::var_os("DSH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env::var_os("USERPROFILE").unwrap()).join(".dsh"));
    let portrait = home.join("peko-pet/icons/yumi-head.ico");
    let icon = if portrait.exists() {
        portrait
    } else {
        PathBuf::from("icons/icon.ico")
    };
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "peko_request",
                "peko_state",
                "peko_activate",
                "peko_cue",
                "peko_reload_config",
                "window_action",
            ]))
            .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(icon)),
    )
    .expect("Tauri build resources");
    println!("cargo:rerun-if-env-changed=PEKO_TYPECHECK");
    if env::var_os("PEKO_TYPECHECK").is_some() {
        println!(
            "cargo:warning=UI type-check only: native linking and SDK validation are not part of this check"
        );
        return;
    }
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    let framework = root.join("vendor/cubism-framework/src");
    let core = root.join("vendor/cubism-core");
    let core_include = root.join("local/cubism-core/include");
    assert!(
        core_include.join("Live2DCubismCore.h").exists(),
        "Cubism Core is missing. Run scripts/import-sdk.ps1 with the official Native 5-r.5 SDK directory."
    );
    let mut files = Vec::new();
    collect(&framework, &mut files);
    files.push(framework.join("Rendering/CubismRenderer.cpp"));
    files.push(framework.join("Rendering/csmBlendMode.cpp"));
    collect(&framework.join("Rendering/D3D11"), &mut files);
    files.push(root.join("native/peko.cpp"));
    files.push(root.join("native/window.cpp"));
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let mut shaders = String::new();
    for (name, symbol) in [
        ("CubismEffect.fx", "PEKO_EFFECT_SHADER"),
        ("CubismBlendMode.fx", "PEKO_BLEND_SHADER"),
    ] {
        let file = framework.join("Rendering/D3D11/Shaders").join(name);
        let source = fs::read_to_string(&file).expect("Cubism D3D11 shader source");
        shaders.push_str(&format!("static const unsigned char {symbol}[] = {{\n"));
        for chunk in source.as_bytes().chunks(32) {
            for byte in chunk {
                shaders.push_str(&format!("{byte},"));
            }
            shaders.push('\n');
        }
        shaders.push_str("};\n");
        println!("cargo:rerun-if-changed={}", file.display());
    }
    fs::write(out.join("peko_shaders.h"), shaders).expect("Embed Cubism shaders");
    let mut build = cc::Build::new();
    build
        .cpp(true)
        .std("c++17")
        .flag("/utf-8")
        .flag("/EHsc")
        .define("NOMINMAX", None)
        .define("UNICODE", None)
        .define("_UNICODE", None)
        .include(&framework)
        .include(&out)
        .include(&core_include)
        .include(root.join("native"));
    for file in &files {
        build.file(file);
        println!("cargo:rerun-if-changed={}", file.display());
    }
    build.compile("peko_native");
    println!(
        "cargo:rustc-link-search=native={}",
        core.join("lib").display()
    );
    println!("cargo:rustc-link-lib=static=Live2DCubismCore_MD");
    for lib in [
        "d3d11",
        "dxgi",
        "dcomp",
        "d3dcompiler",
        "user32",
        "shell32",
        "ole32",
        "gdi32",
        "dwmapi",
    ] {
        println!("cargo:rustc-link-lib={lib}");
    }
}
