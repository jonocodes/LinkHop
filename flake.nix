{
  description = "LinkHop Nix build and Docker runtime";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
    };

    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      pyproject-nix,
      uv2nix,
      pyproject-build-systems,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;

        workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ./.; };

        python = lib.head (
          pyproject-nix.lib.util.filterPythonInterpreters {
            inherit (workspace) requires-python;
            inherit (pkgs) pythonInterpreters;
          }
        );

        pythonBase = pkgs.callPackage pyproject-nix.build.packages {
          inherit python;
        };

        overlay = workspace.mkPyprojectOverlay {
          sourcePreference = "wheel";
        };

        editableOverlay = workspace.mkEditablePyprojectOverlay {
          root = "$REPO_ROOT";
        };

        pyprojectOverrides = final: prev: {
          http-ece = prev.http-ece.overrideAttrs (old: {
            nativeBuildInputs =
              (old.nativeBuildInputs or [ ])
              ++ final.resolveBuildSystem {
                setuptools = [ ];
                wheel = [ ];
              };
          });
        };

        pythonSet = pythonBase.overrideScope (
          lib.composeManyExtensions [
            pyproject-build-systems.overlays.default
            overlay
            pyprojectOverrides
          ]
        );

        editablePythonSet = pythonSet.overrideScope editableOverlay;

        runtimeEnv = pythonSet.mkVirtualEnv "linkhop-env" workspace.deps.default;
        devEnv = editablePythonSet.mkVirtualEnv "linkhop-dev-env" workspace.deps.all;

        entrypoint = pkgs.writeShellScriptBin "linkhop-entrypoint" ''
          set -euo pipefail

          export PATH="${lib.makeBinPath [
            runtimeEnv
            pkgs.sqlite
          ]}:$PATH"
          export PYTHONDONTWRITEBYTECODE=1
          export PYTHONUNBUFFERED=1
          export DJANGO_SETTINGS_MODULE="''${DJANGO_SETTINGS_MODULE:-linkhop.settings.production}"
          export DATABASE_URL="''${DATABASE_URL:-sqlite:///data/db.sqlite3}"
          export STATIC_ROOT="''${STATIC_ROOT:-/app/staticfiles}"
          export SSL_CERT_FILE="''${SSL_CERT_FILE:-/etc/ssl/certs/ca-bundle.crt}"

          cd /app
          python manage.py migrate --noinput
          python manage.py collectstatic --noinput
          exec gunicorn linkhop.asgi:application \
            -k uvicorn.workers.UvicornWorker \
            -w "''${GUNICORN_WORKERS:-4}" \
            -b 0.0.0.0:"''${PORT:-8000}" \
            --access-logfile - \
            --error-logfile -
        '';

        healthcheck = pkgs.writeShellScriptBin "linkhop-healthcheck" ''
          export PATH="${lib.makeBinPath [ runtimeEnv ]}:$PATH"
          export SSL_CERT_FILE="''${SSL_CERT_FILE:-/etc/ssl/certs/ca-bundle.crt}"
          exec python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/admin/login/')"
        '';

        runtimeRoot = pkgs.runCommand "linkhop-runtime-root" { } ''
          mkdir -p "$out/app" "$out/bin" "$out/etc/ssl/certs"

          cp -R ${./core} "$out/app/core"
          cp -R ${./linkhop} "$out/app/linkhop"
          cp -R ${./templates} "$out/app/templates"
          cp ${./manage.py} "$out/app/manage.py"
          cp ${./pyproject.toml} "$out/app/pyproject.toml"
          cp ${./uv.lock} "$out/app/uv.lock"
          mkdir -p "$out/app/data" "$out/app/staticfiles"

          ln -s ${entrypoint}/bin/linkhop-entrypoint "$out/bin/linkhop-entrypoint"
          ln -s ${healthcheck}/bin/linkhop-healthcheck "$out/bin/linkhop-healthcheck"
          ln -s ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt "$out/etc/ssl/certs/ca-bundle.crt"
        '';
      in
      {
        packages.default = runtimeRoot;

        devShells.default = pkgs.mkShell {
          packages = [
            devEnv
            pkgs.uv
            pkgs.sqlite
          ];

          env = {
            UV_NO_SYNC = "1";
            UV_PYTHON = editablePythonSet.python.interpreter;
            UV_PYTHON_DOWNLOADS = "never";
          };

          shellHook = ''
            unset PYTHONPATH
            export REPO_ROOT=$(git rev-parse --show-toplevel)
          '';
        };
      }
    );
}
