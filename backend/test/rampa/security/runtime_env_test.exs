defmodule Rampa.Security.RuntimeEnvTest do
  use ExUnit.Case, async: true

  alias Rampa.Security.RuntimeEnv

  describe "effective/2" do
    test "a release :e2e só vale como :e2e com RAMPA_E2E=1" do
      assert RuntimeEnv.effective(:e2e, "1") == :e2e
    end

    test "a release :e2e sem o marcador, ou com outro valor, segue as regras de produção" do
      for marker <- [nil, "", "0", "true", "yes", " 1"] do
        assert RuntimeEnv.effective(:e2e, marker) == :prod, inspect(marker)
      end
    end

    test "os outros ambientes não mudam com o marcador" do
      for env <- [:prod, :dev, :test], marker <- [nil, "1"] do
        assert RuntimeEnv.effective(env, marker) == env
      end
    end
  end
end
